/**
 * The socket to the server, opened once at module scope.
 *
 * Not in an effect: StrictMode runs effects twice in development, which would
 * open two sockets and fold every event into the conversation twice.
 */
import { applyServerEvent, replaceConversation, setStatus } from "./store";
import type { ConfigMsg, Item, ServerMsg, SessionInfo, UsageMsg } from "./types";

export interface ClientMsg {
	type: string;
	[key: string]: unknown;
}

type Handlers = {
	config: (msg: ConfigMsg) => void;
	usage: (msg: UsageMsg) => void;
	sessions: (list: SessionInfo[]) => void;
	raw: (event: ServerMsg) => void;
};

const handlers: Partial<Handlers> = {};

/** Let React register where the non-conversation messages should land. */
export function setHandlers(next: Partial<Handlers>): void {
	Object.assign(handlers, next);
}

const ws = new WebSocket(`ws://${location.host}/ws`);

ws.onopen = () => setStatus("idle");
ws.onclose = () => setStatus("disconnected");

ws.onmessage = (e: MessageEvent<string>) => {
	const msg = JSON.parse(e.data) as ServerMsg;
	switch (msg.type) {
		case "config":
			handlers.config?.(msg as ConfigMsg);
			return;
		case "usage":
			handlers.usage?.(msg as UsageMsg);
			return;
		case "sessions":
			handlers.sessions?.((msg as { sessions: SessionInfo[] }).sessions);
			return;
		case "snapshot":
			replaceConversation((msg as { items: Item[] }).items);
			return;
		default:
			handlers.raw?.(msg);
			applyServerEvent(msg);
	}
};

export function send(msg: ClientMsg): void {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
