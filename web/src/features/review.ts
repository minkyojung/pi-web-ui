/**
 * Looking over what a run did to the note, a change at a time.
 *
 * A diff is made of two texts, and the server has both: the note as it is, and
 * the note as it stood before pi's first write of the run, replayed from the
 * log. It sends the second when the run stops — see note_review — and this
 * puts the editor into CodeMirror's own unified merge view, which is where the
 * work of drawing a diff already is. What pi added is coloured in place; what
 * pi removed is drawn above it in a widget, because it is not in the file and
 * must not be put there.
 *
 * Only while pi has just written. After the person has typed for a while
 * "before" is no longer one text, so the diff closes and the marks on the
 * words — see pending.ts — are what is left to say whose they are. Cursor and
 * Zed scope their diffs to the same moment for the same reason.
 *
 * The marks from pending.ts are not drawn while it is open. Both say "pi wrote
 * this", the diff says it better and says more, and drawn at once they are one
 * wash over another with a dotted line under it. They are hidden rather than
 * taken out: the marks are a state field, and a field taken out of the editor
 * and put back comes back empty — it would then say nothing until the server
 * next sent the note, which after a review it has no reason to do.
 *
 * Accepting is not only the view's business. The merge view forgets a chunk it
 * has accepted, but the record has to be told too, or the words stay pi's and
 * stay marked; so accept sends `accept_note` for the chunk as well. Rejecting
 * needs nothing: it puts the text back, which is an edit like any other, saved
 * and logged as the person's.
 */
import { acceptChunk, getChunks, rejectChunk, unifiedMergeView } from "@codemirror/merge";
import { Compartment, type Extension, Prec } from "@codemirror/state";
import { type Command, EditorView, keymap } from "@codemirror/view";
import { buttonVariants } from "../components/ui/button";
import { send } from "../ws";

/** Whether a diff is being looked over right now. */
export const reviewing = (view: EditorView): boolean => getChunks(view.state) !== null;

const room = new Compartment();

/**
 * Show the note against `original`, or close what is showing and put the marks
 * back.
 *
 * A reconfiguration rather than a state field, because what goes in is a whole
 * extension — a diff needs its own decorations, widgets and gutter, and they
 * are only wanted while there is a diff.
 */
export function showDiff(view: EditorView, original: string | null): void {
	view.dispatch({ effects: room.reconfigure(original === null ? [] : [diff(original), open]) });
}

/**
 * The chunk under the cursor, in the note's own coordinates.
 *
 * `fromB`/`toB` are where the chunk sits in the text as it is; a chunk that is
 * only a removal covers nothing there, and has nothing to accept.
 */
function chunkAt(view: EditorView, pos: number): { from: number; to: number } | null {
	const found = getChunks(view.state);
	if (!found) return null;
	for (const chunk of found.chunks) {
		if (pos >= chunk.fromB && pos <= chunk.toB) return { from: chunk.fromB, to: chunk.toB };
	}
	return null;
}

/**
 * Take the chunk under the cursor: it stays pi's in the record and stops being
 * drawn, the same as accepting a mark. The view is told first, because telling
 * the server is a round trip and the button should not wait for it.
 */
const accept = (path: () => string): Command => (view) => {
	const chunk = chunkAt(view, view.state.selection.main.head);
	if (!chunk) return false;
	if (!acceptChunk(view, chunk.from)) return false;
	if (chunk.to > chunk.from) send({ type: "accept_note", path: path(), from: chunk.from, to: chunk.to });
	return true;
};

/** Put the chunk under the cursor back the way it was. That is the person's edit, and saved as one. */
const reject: Command = (view) => {
	const chunk = chunkAt(view, view.state.selection.main.head);
	return chunk ? rejectChunk(view, chunk.from) : false;
};

/** Said on the editor while a diff is open, so the rules below can defer to it. */
const open = EditorView.editorAttributes.of({ class: "cm-reviewing" });

const style = EditorView.baseTheme({
	// pending.ts's marks, out of the way of the diff that is already saying it.
	// `&` is the editor's own element, which is where the class sits.
	"&.cm-reviewing .cm-pi": { backgroundColor: "transparent", borderBottom: "none" },
	".cm-deletedChunk": { backgroundColor: "color-mix(in oklab, var(--destructive) 12%, transparent)" },
	".cm-changedLine": { backgroundColor: "color-mix(in oklab, var(--primary) 8%, transparent)" },
	".cm-changedText": { backgroundColor: "color-mix(in oklab, var(--primary) 18%, transparent)" },
	".cm-deletedChunk .cm-deletedText": { backgroundColor: "color-mix(in oklab, var(--destructive) 22%, transparent)" },
	".cm-chunkButtons": { gap: "0.25rem" },
});

/** The accept and reject buttons, wearing the same chrome as every other button here. */
const control = (kind: "accept" | "reject", act: (e: MouseEvent) => void): HTMLElement => {
	const button = document.createElement("button");
	button.className = buttonVariants({ variant: kind === "accept" ? "secondary" : "ghost", size: "xs" });
	button.textContent = kind === "accept" ? "Keep" : "Undo";
	button.onclick = act;
	return button;
};

const diff = (original: string): Extension =>
	unifiedMergeView({
		original,
		// Word level, not line level. A note is prose: a reworded sentence
		// shown as a deleted paragraph and an inserted one is not a diff of it.
		allowInlineDiffs: true,
		gutter: false,
		syntaxHighlightDeletions: false,
		mergeControls: control,
	}) as Extension;

export function review(path: () => string): Extension {
	return [
		room.of([]),
		style,
		// Above pending.ts's, which are above the editor's own: while a diff is
		// being looked over these keys are about its chunks, and they fall
		// through to the marks underneath when there is no chunk here.
		Prec.highest(
			keymap.of([
				{ key: "Mod-Enter", run: accept(path) },
				{ key: "Mod-Backspace", run: reject },
				{ key: "Escape", run: (v) => (reviewing(v) ? (showDiff(v, null), true) : false) },
			]),
		),
	];
}
