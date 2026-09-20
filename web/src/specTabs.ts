/**
 * Which of a spec's documents the window should put in front.
 *
 * The agent writes a document and stops, and until the person has read it and
 * approved it nothing else in that spec can happen — so the document that has
 * just started waiting is the one thing to be looking at, and it comes to the
 * front by itself. Kiro opens its specs the same way; what is different here
 * is that the window is told the state rather than the writing (SpecsMsg), so
 * a document the terminal's pi wrote opens as one written in the app does.
 *
 * Only as it starts waiting. A document that has been waiting since before —
 * one the person read and closed, one being changed again while it waits —
 * does not come back: a window that keeps reopening what was closed is worse
 * than one that opens nothing. The exception is a window with an empty middle
 * column, which has nothing better to show and is where a new workspace
 * starts.
 *
 * Pure, and the rule in one place: App.tsx holds the two states this reads.
 */
import { SPECS_DIR } from "../../documentKinds.ts";
import type { SpecInfo } from "../../protocol.ts";

/** Where a spec's waiting document is, as a path from the folder, or null when none is. */
export const waitingPath = (spec: SpecInfo): string | null => (spec.waiting ? `${SPECS_DIR}${spec.name}/${spec.waiting}` : null);

/** The newest of the specs given, by when its waiting document was written; of none, null. */
function newest(waiting: SpecInfo[]): string | null {
	let best: SpecInfo | null = null;
	// At least as new wins, so that of several written in the same millisecond
	// — or of several the disk cannot date — it is the last listed.
	for (const spec of waiting) if (!best || (spec.waitingAt ?? 0) >= (best.waitingAt ?? 0)) best = spec;
	return best && waitingPath(best);
}

/**
 * The document to open, or null for none: one that has just started waiting,
 * and of several the newest. With nothing heard before — the window has just
 * opened — the one waiting, but only into an empty middle column.
 */
export function toOpen(before: SpecInfo[] | null, after: SpecInfo[], anythingOpen: boolean): string | null {
	const waiting = after.filter((spec) => spec.waiting !== null);
	if (before === null) return anythingOpen ? null : newest(waiting);
	const was = new Map(before.map((spec) => [spec.name, spec.waiting]));
	return newest(waiting.filter((spec) => was.get(spec.name) !== spec.waiting));
}
