/**
 * Every note's text, searched the way grep would: no index, read on each ask.
 *
 * The notes are the truth and there are a few thousand of them at most, so
 * reading them all per query costs less than keeping a second copy of them in
 * step. An index is for when this is felt, and it is not yet.
 *
 * Pure: the server hands in the notes, lazily, and stops reading once the
 * results are full.
 */

export type SearchHit = {
	path: string;
	/** 1-based, as grep counts. */
	line: number;
	/** The line, cut to a window around the match, with … where it was cut. */
	text: string;
	/** Where the match is in `text`. */
	from: number;
	to: number;
};

/** A note that says it on every line should not push the others off the list. */
export const PER_NOTE = 3;
export const LIMIT = 50;
/** Enough to read a clause either side; one row of a palette. */
const WIDTH = 120;
const BEFORE = 40;

/**
 * Lines that contain `query`, case aside, one hit per line: the row shows a
 * line, and three rows of the same line would say nothing more.
 */
export function search(notes: Iterable<{ path: string; text: string }>, query: string): SearchHit[] {
	const needle = query.trim();
	if (!needle) return [];
	// A regex rather than toLowerCase on both sides: lowering can change a
	// string's length ("İ" becomes two units), and then an index found in the
	// lowered line is not the same place in the line.
	const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
	const hits: SearchHit[] = [];
	for (const { path, text } of notes) {
		let found = 0;
		const lines = text.split(/\r?\n/);
		for (let i = 0; i < lines.length && found < PER_NOTE; i++) {
			const match = pattern.exec(lines[i]);
			if (!match) continue;
			hits.push({ path, line: i + 1, ...excerpt(lines[i], match.index, match.index + match[0].length) });
			found++;
			if (hits.length >= LIMIT) return hits;
		}
	}
	return hits;
}

/** The part of a long line around [from, to), the match's place carried into it. */
export function excerpt(line: string, from: number, to: number): { text: string; from: number; to: number } {
	if (line.length <= WIDTH) return { text: line, from, to };
	let start = Math.max(0, Math.min(from - BEFORE, line.length - WIDTH));
	let end = Math.max(to, Math.min(line.length, start + WIDTH));
	// Not between the halves of a surrogate pair, which would draw as a broken glyph.
	if (isLowSurrogate(line, start)) start--;
	if (isLowSurrogate(line, end)) end++;
	const head = start > 0 ? "…" : "";
	const tail = end < line.length ? "…" : "";
	return { text: head + line.slice(start, end) + tail, from: from - start + head.length, to: to - start + head.length };
}

function isLowSurrogate(s: string, i: number): boolean {
	const c = s.charCodeAt(i);
	return c >= 0xdc00 && c <= 0xdfff;
}
