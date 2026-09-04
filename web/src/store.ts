/**
 * The conversation, as React can see it.
 *
 * conversation.js updates items in place — a text delta appends to the item it
 * is already holding. That is what lets the old DOM client rewrite one node and
 * leave the rest alone, and it is exactly what React cannot see: the object
 * never changes identity. Rather than change the reducer, which the server also
 * imports and the test suite pins, this module copies the items the reducer says
 * it touched into a fresh array. Everything React reads is then ordinary
 * immutable data, so a memoized row skips a render on object identity alone.
 */
import { applyEvent, createConversation } from "../../conversation.js";

import type { Item, ServerMsg } from "./types";

type Conversation = ReturnType<typeof createConversation>;

let convo: Conversation = createConversation();
/** The immutable projection React renders. */
let items: Item[] = [];
/** Where each of the reducer's own item objects landed in `items`. */
let index = new Map<object, number>();
let agentStatus = "idle";
/** Whether the socket is up. Separate from agentStatus, which describes the run. */
let connection: Connection = "connecting";

const listeners = new Set<() => void>();
let frame: number | null = null;

export function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export type Connection = "connecting" | "open" | "reconnecting";

export const getItems = (): Item[] => items;
export const getAgentStatus = (): string => agentStatus;
export const getConnection = (): Connection => connection;

export function setConnection(next: Connection): void {
	connection = next;
	notify();
}

/**
 * Deltas arrive far faster than the screen repaints, so a burst of them settles
 * into one render. The projection itself is eager, so nothing is lost if the
 * frame is late.
 */
function notify(): void {
	if (frame !== null) return;
	frame = requestAnimationFrame(() => {
		frame = null;
		for (const listener of listeners) listener();
	});
}

const STATUS_LABEL: Record<string, string> = { working: "working…", idle: "idle" };

export function applyServerEvent(event: ServerMsg): void {
	const { added, changed } = applyEvent(convo, event) as { added: Item[]; changed: Item[] };
	agentStatus = STATUS_LABEL[convo.status] ?? convo.status;

	if (added.length || changed.length) {
		// A tool writes partial output into `result` while it is still running, so
		// `result !== null` cannot stand in for "finished" — the spinner would
		// vanish the moment the first chunk of a long command arrived. The reducer
		// already tracks exactly this in openTools; read it rather than duplicate
		// the bookkeeping. A tool item is in `added` when it opens and in
		// `changed` when it ends, so the flag is refreshed at both transitions,
		// and an untouched item's flag cannot have gone stale.
		const running = new Set<object>(convo.openTools.values());
		const project = (item: Item): Item => ({ ...item, pending: running.has(item) });
		const next = items.slice();
		// Adds come first: a delta with no text_start opens an item and appends
		// to it in the same event, so the item is in both lists and has to have
		// a place in `next` before the copy is overwritten.
		for (const item of added) {
			index.set(item, next.length);
			next.push(project(item));
		}
		for (const item of changed) next[index.get(item)!] = project(item);
		items = next;
	}
	notify();
}

/** A replaced session emits no events for its history, so it arrives whole. */
export function replaceConversation(snapshot: Item[]): void {
	convo = createConversation();
	convo.items = snapshot;
	index = new Map(snapshot.map((item, i) => [item, i]));
	// A snapshot is stored history, which by definition has no tool still running.
	items = snapshot.map((item) => ({ ...item, pending: false }));
	agentStatus = STATUS_LABEL[convo.status] ?? convo.status;
	notify();
}
