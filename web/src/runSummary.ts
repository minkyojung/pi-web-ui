import type { Item } from "./types";

/**
 * What a finished run did, in one line.
 *
 * A run is mostly things the model did on the way to an answer, and once the
 * answer is on screen those steps are history: worth keeping, not worth the
 * height. So they fold into a single row, and this is what that row says.
 *
 * Two counts, not a list of names. The names were tried first and read as
 * `ls · find · grep · +7 more` on anything but a short run — a line that gives
 * up halfway is worse than one that never started, and the row's job is to say
 * how much is under it, not to be the thing under it.
 *
 * It says how many, never how much — the footer under the run already carries
 * the duration, the clock, the tokens and the cost, and a second line repeating
 * any of them would be two lines saying one thing.
 */

export interface RunSummary {
	/** Tool calls, counted per call: two greps are two. */
	tools: number;
	/**
	 * Assistant messages these steps came from — how many times the model went
	 * out and came back before the answer. Counted from the mark each step
	 * carries, because a message is not an item and cannot be counted by eye:
	 * two thoughts in one message look exactly like two thoughts in two.
	 *
	 * The answer itself is not among them. This row holds the work, and the
	 * message the work was for is the paragraph below it, already on screen.
	 */
	messages: number;
	/** Tool calls that came back an error. */
	failed: number;
}

export function summarise(items: Item[]): RunSummary {
	const messages = new Set<number>();
	let tools = 0;
	let failed = 0;

	for (const item of items) {
		if (item.message !== undefined) messages.add(item.message);
		if (item.kind !== "tool") continue;
		tools++;
		if (item.isError) failed++;
	}

	return { tools, messages: messages.size, failed };
}

/** An item where it sits, or a stretch of them folded into one row. */
export type Row = { kind: "item"; index: number } | { kind: "group"; index: number; items: Item[] };

/** The kinds that are steps towards an answer rather than part of one. */
const ACTIVITY = new Set(["thinking", "tool"]);

/**
 * The list as it is drawn: which items stand on their own, and which fold.
 *
 * Only consecutive steps fold, and only within a run that has ended. Both
 * halves of that are deliberate:
 *
 * Consecutive, because gathering every step of a run into one row would hoist
 * the last tool call above the sentence the model wrote before calling it. The
 * order things happened in is the one thing a transcript owes the reader.
 *
 * Ended, because a run in flight is the one time these rows are worth their
 * height — they are the only sign anything is happening. So a live run is drawn
 * exactly as it was before this existed, and folding is something that happens
 * to a run once, when `done` arrives, with no timer and nothing to flicker.
 *
 * A stretch of one does not fold. `read` folded to "read" is the same row minus
 * the file it read.
 */
export function rowsOf(items: Item[]): Row[] {
	// A run is over once a `done` has been appended after it. Items are only
	// ever appended, so the last one is the only one worth finding.
	let lastDone = -1;
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i].kind === "done") {
			lastDone = i;
			break;
		}
	}

	const rows: Row[] = [];
	for (let i = 0; i < items.length; ) {
		let end = i;
		while (end < items.length && ACTIVITY.has(items[end].kind)) end++;
		if (end - i > 1 && end - 1 < lastDone) {
			rows.push({ kind: "group", index: i, items: items.slice(i, end) });
			i = end;
		} else {
			rows.push({ kind: "item", index: i });
			i++;
		}
	}
	return rows;
}
