/**
 * What `⌘P` offers of the repository, beside the notes it has always offered.
 *
 * The notes are a small list and are mounted whole; a repository's files are
 * not. Thousands of rows in the palette is thousands of components built on
 * every keystroke, so the repository's are narrowed here first and only what
 * could be wanted is handed over — the palette then orders what it was given,
 * as it does the notes.
 *
 * Nothing until something is typed. A list that opens on twenty thousand
 * paths has answered no question; before a letter is typed the useful list is
 * the one that was already there — what was open recently, and the notes.
 *
 * Pure, so it can be tested without a box.
 */
import { matchNotes } from "./noteMention.ts";

/**
 * How many the palette mounts. A palette shows eight rows at a time and is
 * scrolled rather than read, so this is the depth a narrowing search reaches
 * into, not a page size — past it the answer is to type another letter.
 */
export const SHOWN = 50;

/**
 * The repository's files the typed word could mean, ranked as a note's path
 * is (matchNotes) and without the ones another group already shows: a note
 * and a document are on this list too, and a row that appears twice under two
 * headings is the palette saying there are two files.
 */
export function repoOffers(repo: string[], already: ReadonlySet<string>, query: string, limit = SHOWN): string[] {
	const trimmed = query.trim();
	if (!trimmed) return [];
	return matchNotes(
		repo.filter((path) => !already.has(path)),
		trimmed,
	).slice(0, limit);
}
