import type { Item } from "./types";

type Details = NonNullable<Item["details"]>;

export interface DiffStat {
	added: number;
	removed: number;
}

/**
 * How many lines an edit added and removed.
 *
 * Counted here rather than carried on the item, the way a duration is carried
 * as two times and written out by the renderer: the reducer's job is to say
 * what pi said, and a pair of totals derived from a string it already holds is
 * not a second fact about the run.
 *
 * pi's display diff numbers every line and marks the changed ones, so a line
 * reads `+3 The beta stage…` — the mark is the first character, and every line
 * has one.
 */
export function diffStat(diff: string): DiffStat {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

/**
 * What a result has to say for itself that its text does not: that it is not
 * all of the output, or that the tool stopped where it was told to.
 *
 * Both belong on the row rather than inside it, because both are reasons to
 * distrust what the row already shows, and a reason to distrust something has
 * to arrive before it is read.
 */
export function detailNotes(details: Details | undefined): string[] {
	if (!details) return [];
	const notes = [];
	if (typeof details.omittedLines === "number") {
		notes.push(`${details.omittedLines.toLocaleString()} more lines`);
	}
	if (typeof details.limit === "number") notes.push(`limit ${details.limit.toLocaleString()}`);
	return notes;
}
