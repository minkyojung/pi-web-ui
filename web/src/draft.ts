/**
 * What is typed to pi and not yet sent.
 *
 * The box is uncontrolled and lives in the composer, and the composer lives
 * wherever pi is put. When pi moves — from the column to a corner, say — its
 * component is remade, and a box that kept its own text would come back
 * empty. So the text is kept here, outside any component, the way Slack and
 * Linear keep a draft per place: read when the box is made, written as it is
 * typed in, and emptied when it is sent.
 */
import { createStore } from "./serverState.ts";

export const draftStore = createStore<string>("", { window: true });

/** Each folder's draft while the window is on another — a draft per place, as Slack keeps one per channel. */
const kept = new Map<string, string>();

/** The window moved from one folder to another: what was typed stays with the folder it was typed for, and the other's comes back. */
export function switchDraft(from: string | null, to: string): void {
	if (from) kept.set(from, draftStore.get());
	draftStore.set(kept.get(to) ?? "");
}
