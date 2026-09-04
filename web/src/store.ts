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
let statusText = "connecting…";

const listeners = new Set<() => void>();
let frame: number | null = null;

export function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export const getItems = (): Item[] => items;
export const getStatus = (): string => statusText;

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
	statusText = STATUS_LABEL[convo.status] ?? convo.status;

	if (added.length || changed.length) {
		const next = items.slice();
		// Adds come first: a delta with no text_start opens an item and appends
		// to it in the same event, so the item is in both lists and has to have
		// a place in `next` before the copy is overwritten.
		for (const item of added) {
			index.set(item, next.length);
			next.push({ ...item });
		}
		for (const item of changed) next[index.get(item)!] = { ...item };
		items = next;
	}
	notify();
}

/** A replaced session emits no events for its history, so it arrives whole. */
export function replaceConversation(snapshot: Item[]): void {
	convo = createConversation();
	convo.items = snapshot;
	index = new Map(snapshot.map((item, i) => [item, i]));
	items = snapshot.map((item) => ({ ...item }));
	statusText = STATUS_LABEL[convo.status] ?? convo.status;
	notify();
}

export function setStatus(text: string): void {
	statusText = text;
	notify();
}
