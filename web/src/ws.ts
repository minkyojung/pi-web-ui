/**
 * The socket to the server, and the reconnection around it.
 *
 * Opened at module scope rather than in an effect: StrictMode runs effects
 * twice in development, which would open two sockets and fold every event into
 * the conversation twice.
 */
import {
	addPrompt,
	branchesStore,
	configStore,
	contextSourcesStore,
	filesStore,
	noteChangedStore,
	noteConflictStore,
	noteStore,
	promptsStore,
	pushRaw,
	removePrompt,
	restoredStore,
	sessionsStore,
	usageStore,
} from "./serverState";
import { clearedText } from "./queue";
import { applyServerEvent, replaceConversation, setConnection } from "./store";
import type { ClientMsg, ServerMsg, StateMsg } from "./types";

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
 * Set when a hot update replaces this module. `generation` cannot stand in for
 * it: connect() bumps that counter itself, so a retired instance that reaches
 * connect() writes its way back past its own guard.
 */
let disposed = false;

/**
 * Full jitter, capped low. This is localhost and the usual cause is the server
 * restarting, where a long cap just means staring at a dead tab.
 */
const backoff = () => Math.random() * Math.min(250 * 2 ** attempt, 5000);

/**
 * Every message the server makes up, by type. A record rather than a list so
 * that adding one to StateMsg without adding it here does not compile: a type
 * missing from this table would be taken for a pi event and fed to the reducer.
 */
const STATE: Record<StateMsg["type"], true> = {
	config: true,
	usage: true,
	context_sources: true,
	branches: true,
	sessions: true,
	snapshot: true,
	files: true,
	note: true,
	note_changed: true,
	note_conflict: true,
	prompt_request: true,
	prompt_dismiss: true,
	queue_cleared: true,
	error: true,
};
// hasOwn, not `in`: "constructor" is in every object.
const isStateMsg = (msg: ServerMsg): msg is StateMsg => Object.hasOwn(STATE, msg.type);

function receive(msg: ServerMsg): void {
	// A pi event: what happened in the conversation, for the reducer.
	if (!isStateMsg(msg)) {
		pushRaw(msg);
		applyServerEvent(msg);
		return;
	}
	switch (msg.type) {
		case "config":
			configStore.set(msg);
			return;
		case "usage":
			usageStore.set(msg);
			return;
		case "context_sources":
			contextSourcesStore.set(msg);
			return;
		// The shape of the session tree, not something that happened in the
		// conversation: it must not reach the reducer.
		case "branches":
			branchesStore.set(msg.nodes);
			return;
		case "sessions":
			sessionsStore.set(msg.sessions);
			return;
		case "files":
			filesStore.set(msg.files);
			return;
		case "note":
			noteStore.set(msg);
			return;
		case "note_changed":
			noteChangedStore.set(msg);
			return;
		case "note_conflict":
			noteConflictStore.set(msg);
			return;
		case "snapshot":
			// A snapshot means the server's session may not be the one these
			// questions belonged to (a swap while this tab was offline). Drop
			// them; the replay that follows a snapshot re-adds any still open.
			promptsStore.set([]);
			replaceConversation(msg.items);
			return;
		// The messages a clear took out of the queue, on their way back to the box.
		case "queue_cleared": {
			const text = clearedText(msg);
			if (text) restoredStore.set(text);
			return;
		}
		// Questions are not conversation events and must not reach the reducer.
		case "prompt_request":
			pushRaw(msg);
			addPrompt(msg.prompt);
			return;
		case "prompt_dismiss":
			pushRaw(msg);
			removePrompt(msg.id);
			return;
		// The server's own error, which the reducer draws like pi's.
		case "error":
			pushRaw(msg);
			applyServerEvent(msg);
			return;
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
		// live-only notices, so those disappear from the conversation on
		// reconnect, and a tool that was mid-execution comes back with result:
		// null whose tool_execution_end will find no open entry to attach to and
		// stay pending. This is the same trade resuming a session already makes,
		// and the one the server makes on purpose after a question is asked
		// again, when it rebroadcasts a snapshot so the new question can carry
		// its place in the session tree.
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
	if (disposed) return;
	if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
	attempt = 0;
	connect();
}

// A hidden tab does not run requestAnimationFrame, which is what the store
// renders on, so a backgrounded tab should come back live the moment it is
// looked at rather than at the end of some backoff.
const onVisible = (): void => {
	if (document.visibilityState === "visible") retryNow();
};

addEventListener("online", retryNow);
addEventListener("visibilitychange", onVisible);

// Without this, every hot update of this module leaks a socket and doubles
// every event — the exact bug the module-scope connection exists to avoid.
//
// Closing the socket is not enough on its own: these two listeners live on
// window, outlive the module that registered them, and call a retryNow that
// still holds the retired instance's closed socket. The next window switch
// then reopens it, and both instances fold the same events into one store.
import.meta.hot?.dispose(() => {
	disposed = true;
	generation++;
	removeEventListener("online", retryNow);
	removeEventListener("visibilitychange", onVisible);
	if (timer !== null) clearTimeout(timer);
	socket?.close();
});

// This module owns one socket, so it opts out of being hot-swapped: accepting
// its own update and immediately invalidating turns any update that reaches
// here — its own, or one propagated from store, serverState or queue — into a
// page reload. The teardown above then only has to survive that, rather than
// keep a retired instance harmless while it stays in the page.
//
// A reload costs nothing here. The conversation lives on the server and comes
// back as a snapshot on connect.
import.meta.hot?.accept(() => {
	import.meta.hot?.invalidate("ws.ts owns the socket; reload rather than run two of them");
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
