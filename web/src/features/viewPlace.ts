/**
 * Where a note is being read — the cursor and the scroll — read off the
 * editor and put back on it.
 *
 * What keeps it is the list of where you have been (nav.ts): a place belongs
 * to the step that was being read and not to the note, so that a note read at
 * the top in one step and at its end in another comes back to each as it was.
 * Here is only the knowing how — which box scrolls, and that the text may have
 * grown shorter since. Nothing is remembered in this file.
 *
 * Offsets are UTF-16 code units, which is what both JavaScript strings and
 * CodeMirror count in.
 */
import type { EditorView } from "@codemirror/view";

import type { Left } from "../nav";

/**
 * What scrolls: the page the editor sits on, which holds the title and the
 * backlinks with the text, or the editor's own scroller where there is no
 * page around it. The page is handed in rather than looked up from the
 * editor: by the time a note is left its editor is out of the document, and
 * the tests' stand-in views have no document at all.
 */
export type Scrolls = { scrollTop: number };
const scroller = (view: EditorView, page: Scrolls | null | undefined): Scrolls => page ?? view.scrollDOM;

/** Where the note is being read as it is left. */
export function leaving(view: EditorView, page?: Scrolls | null): Left {
	const { anchor, head } = view.state.selection.main;
	return { anchor, head, scrollTop: scroller(view, page).scrollTop };
}

/** The selection to come back to, fitted to a text of `length`: the note may have been cut since it was read. */
export const fitted = (left: Left, length: number) => ({ anchor: Math.min(left.anchor, length), head: Math.min(left.head, length) });

/** Put the scroll back where it was, once the new text has been drawn. */
export function scrollBack(left: Left, view: EditorView, page?: Scrolls | null): void {
	view.requestMeasure({
		read: () => null,
		write: (_m: null, v: EditorView) => {
			scroller(v, page).scrollTop = left.scrollTop;
		},
	});
}
