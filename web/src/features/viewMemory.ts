/**
 * Where a note was left — the cursor and the scroll — so it opens there
 * again, as in Obsidian.
 *
 * Kept by path, in memory, for as long as the app is open: this is a fact
 * about the person's session, not about the note, so it is not written
 * anywhere. The text is never kept — the disk is the truth and the note is
 * read fresh — so what is remembered is clamped to the text that arrives,
 * which may be shorter than it was.
 */
import type { EditorView } from "@codemirror/view";

export type Left = { anchor: number; head: number; scrollTop: number };

const left = new Map<string, Left>();

/** Note where `path` is being left. */
export function leave(path: string, view: EditorView): void {
	const { anchor, head } = view.state.selection.main;
	left.set(path, { anchor, head, scrollTop: view.scrollDOM.scrollTop });
}

/** The selection to come back to in `path`, fitted to a text of `length`; null if it was never left. */
export function comeBack(path: string, length: number): { anchor: number; head: number } | null {
	const was = left.get(path);
	if (!was) return null;
	return { anchor: Math.min(was.anchor, length), head: Math.min(was.head, length) };
}

/** Put the scroll back where it was, once the new text has been drawn. */
export function scrollBack(path: string, view: EditorView): void {
	const was = left.get(path);
	if (!was) return;
	view.requestMeasure({
		read: () => null,
		write: (_m: null, v: EditorView) => {
			v.scrollDOM.scrollTop = was.scrollTop;
		},
	});
}

/** For tests: what is remembered for `path`. */
export const remembered = (path: string): Left | undefined => left.get(path);

