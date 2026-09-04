/**
 * The socket to the server, opened once at module scope.
 *
 * Not in an effect: StrictMode runs effects twice in development, which would
 * open two sockets and fold every event into the conversation twice.
 */
import { configStore, pushRaw, sessionsStore, usageStore } from "./serverState";
import { applyServerEvent, replaceConversation, setStatus } from "./store";
import type { ConfigMsg, Item, ServerMsg, SessionInfo, UsageMsg } from "./types";

export interface ClientMsg {
	type: string;
	[key: string]: unknown;
}

const ws = new WebSocket(`ws://${location.host}/ws`);

ws.onopen = () => setStatus("idle");
ws.onclose = () => setStatus("disconnected");

ws.onmessage = (e: MessageEvent<string>) => {
	const msg = JSON.parse(e.data) as ServerMsg;
	switch (msg.type) {
		case "config":
			configStore.set(msg as ConfigMsg);
			return;
		case "usage":
			usageStore.set(msg as UsageMsg);
			return;
		case "sessions":
			sessionsStore.set((msg as { sessions: SessionInfo[] }).sessions);
			return;
		case "snapshot":
			replaceConversation((msg as { items: Item[] }).items);
			return;
		default:
			pushRaw(msg);
			applyServerEvent(msg);
	}
};

export function send(msg: ClientMsg): void {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
