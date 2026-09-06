/**
 * The socket to the server, and the reconnection around it.
 *
 * Opened at module scope rather than in an effect: StrictMode runs effects
 * twice in development, which would open two sockets and fold every event into
 * the conversation twice.
 */
import { addPrompt, configStore, contextSourcesStore, promptsStore, pushRaw, removePrompt, sessionsStore, usageStore } from "./serverState";
import { applyServerEvent, replaceConversation, setConnection } from "./store";
import type { ConfigMsg, ContextSourcesMsg, Item, PromptDismissMsg, PromptRequestMsg, ServerMsg, SessionInfo, UsageMsg } from "./types";

export interface ClientMsg {
	type: string;
	[key: string]: unknown;
}

let socket: WebSocket | null = null;
/**
 * Bumped on every connect, and captured by that socket's handlers. A socket
 * that closes after its replacement is already open would otherwise schedule a
 * second reconnect, and from then on the sockets double.
 */
let generation = 0;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Full jitter, capped low. This is localhost and the usual cause is the server
 * restarting, where a long cap just means staring at a dead tab.
 */
const backoff = () => Math.random() * Math.min(250 * 2 ** attempt, 5000);

function receive(msg: ServerMsg): void {
	switch (msg.type) {
		case "config":
			configStore.set(msg as ConfigMsg);
			return;
		case "usage":
			usageStore.set(msg as UsageMsg);
			return;
		case "context_sources":
			contextSourcesStore.set(msg as ContextSourcesMsg);
			return;
		case "sessions":
			sessionsStore.set((msg as { sessions: SessionInfo[] }).sessions);
			return;
		case "snapshot":
			// A snapshot means the server's session may not be the one these
			// questions belonged to (a swap while this tab was offline). Drop
			// them; the replay that follows a snapshot re-adds any still open.
			promptsStore.set([]);
			replaceConversation((msg as { items: Item[] }).items);
			return;
		// Questions are not conversation events and must not reach the reducer.
		case "prompt_request":
			pushRaw(msg);
			addPrompt((msg as PromptRequestMsg).prompt);
			return;
		case "prompt_dismiss":
			pushRaw(msg);
			removePrompt((msg as PromptDismissMsg).id);
			return;
		default:
			pushRaw(msg);
			applyServerEvent(msg);
	}
}

function connect(): void {
	if (timer !== null) {
		clearTimeout(timer);
		timer = null;
	}
	const gen = ++generation;
	setConnection(attempt === 0 ? "connecting" : "reconnecting");

	const ws = new WebSocket(`ws://${location.host}/ws`);
	socket = ws;

	ws.onopen = () => {
		if (gen !== generation) return;
		setConnection("open");
		// Recovery is entirely server-driven: it pushes config, usage, snapshot
		// and sessions on connect, so there is nothing to ask for here.
		//
		// What the snapshot cannot carry, it loses. itemsFromMessages emits no
		// `done` markers and no live-only notices, so those disappear from the
		// conversation on reconnect, and a tool that was mid-execution comes
		// back with result: null whose tool_execution_end will find no open
		// entry to attach to and stay pending. This is the same trade resuming
		// a session already makes. Rebroadcasting a snapshot on agent_settled
		// would not fix it and would delete every `done` in the conversation.
	};
	ws.onmessage = (e: MessageEvent<string>) => {
		if (gen !== generation) return;
		// The backoff resets here rather than on open. In development the socket
		// goes through the vite proxy, which accepts the upgrade and then closes
		// it when the API server is down — resetting on open would turn that
		// into an unthrottled retry loop. A message means it really works.
		attempt = 0;
		receive(JSON.parse(e.data) as ServerMsg);
	};
	ws.onclose = () => {
		if (gen !== generation) return;
		setConnection("reconnecting");
		timer = setTimeout(connect, backoff());
		attempt++;
	};
	// An 'error' is always followed by a 'close', which does the reconnecting.
	ws.onerror = () => {};
}

/** Skip the wait when something says the connection should work now. */
function retryNow(): void {
	if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
	attempt = 0;
	connect();
}

addEventListener("online", retryNow);
// A hidden tab does not run requestAnimationFrame, which is what the store
// renders on, so a backgrounded tab should come back live the moment it is
// looked at rather than at the end of some backoff.
addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") retryNow();
});

// Without this, every hot update of this module leaks a socket and doubles
// every event — the exact bug the module-scope connection exists to avoid.
import.meta.hot?.dispose(() => {
	generation++;
	if (timer !== null) clearTimeout(timer);
	socket?.close();
});

connect();

/**
 * Returns false when the socket is down. Nothing is queued: a prompt replayed
 * after a reconnect can land in a session that was swapped underneath it, or
 * land twice if the close came after the frame went out. The UI disables its
 * controls instead.
 */
export function send(msg: ClientMsg): boolean {
	if (socket?.readyState !== WebSocket.OPEN) return false;
	socket.send(JSON.stringify(msg));
	return true;
}
