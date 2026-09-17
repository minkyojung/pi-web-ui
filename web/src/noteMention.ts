/**
 * Type `@` and the notes are offered.
 *
 * pi's terminal offers files after an `@` in its input; its library has no
 * such thing, so this is Octave's, over the notes the vault lists. Unlike a
 * command (commandMenu.ts), a mention can sit anywhere in a message: what is
 * read is the word the cursor is at the end of, if it begins with `@` and
 * nothing but a space or the start of the text comes before it. What is
 * written in is the note's path, the way pi's own `@file` argument names a
 * file — the words, not the note: reading it is pi's `read` tool's job.
 *
 * Pure, so it can be tested without a box.
 */
import { titleOf } from "../../naming.ts";

/** The `@word` the cursor is at the end of: where it starts and what is typed after the `@`. */
export function mentionQuery(text: string, cursor: number): { from: number; query: string } | null {
	const before = text.slice(0, cursor);
	const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
	if (!m) return null;
	return { from: before.length - m[1].length - 1, query: m[1] };
}

/**
 * The notes the word could mean: those whose title the word begins, then
 * those whose title holds it, then those whose path holds it. Case does not
 * matter. Order within a rank is the vault's.
 */
export function matchNotes(paths: string[], query: string): string[] {
	const q = query.toLowerCase();
	if (!q) return paths;
	const rank = (path: string) => {
		const title = titleOf(path).toLowerCase();
		if (title.startsWith(q)) return 0;
		if (title.includes(q)) return 1;
		if (path.toLowerCase().includes(q)) return 2;
		return null;
	};
	const ranked = paths.flatMap((p) => {
		const r = rank(p);
		return r === null ? [] : [{ p, r }];
	});
	return ranked.sort((a, b) => a.r - b.r).map((x) => x.p);
}

/** The text with the `@word` at `from`…`cursor` replaced by the note's path and a space, and where the cursor lands. */
export function acceptMention(text: string, from: number, cursor: number, path: string): { text: string; cursor: number } {
	const written = `@${path} `;
	return { text: text.slice(0, from) + written + text.slice(cursor), cursor: from + written.length };
}
