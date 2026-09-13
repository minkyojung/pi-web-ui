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
 * The marks are not drawn while it is open. Both say "pi wrote this", the diff
 * says it better and says more, and drawn at once they are one wash over
 * another with a dotted line under it. They are hidden rather than taken out:
 * the marks are a state field, and a field taken out of the editor and put
 * back comes back empty — it would then say nothing at all until the server
 * next sent the note, which after a review it has no reason to do.
 *
 * Both decisions are undone by ⌘Z, and that costs something to arrange.
 * Undoing a chunk is a plain edit and the editor's own history takes it. But
 * keeping one changes no text at all: it moves the diff's idea of "before" up
 * to meet the note, and tells the record the words have been looked at.
 * Neither is a document change, so the history would not see it and ⌘Z would
 * pass it by — one button whose effect can be taken back, beside one whose
 * cannot. So the keeping is put into the history the way CodeMirror provides
 * for, with `invertedEffects`, and the record is told again the other way
 * round: the log is append-only, so a decision is unmade by writing its
 * opposite.
 */
import { getChunks, getOriginalDoc, rejectChunk, unifiedMergeView, updateOriginalDoc } from "@codemirror/merge";
import { invertedEffects } from "@codemirror/commands";
import { ChangeSet, Compartment, type Extension, StateEffect, type Text } from "@codemirror/state";
import { type Command, EditorView } from "@codemirror/view";
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
 * A chunk kept, or a keeping taken back.
 *
 * `was` and `changes` are what the keeping did to the text the diff is
 * against, held so it can be done backwards. `from` and `to` are where the
 * chunk sits in the note, for the record — and those move with the note, so
 * the effect says how: one the history holds on to has to survive the edits
 * made after it.
 */
type Decision = { from: number; to: number; was: Text; changes: ChangeSet; kept: boolean };

const decided = StateEffect.define<Decision>({
	map: (value, change) => ({ ...value, from: change.mapPos(value.from), to: change.mapPos(value.to) }),
});

/** The chunk covering a place, or null. `endB`, not `toB`: a chunk that took a whole line ends past it. */
function chunkAt(view: EditorView, pos: number) {
	return getChunks(view.state)?.chunks.find((chunk) => chunk.fromB <= pos && chunk.endB >= pos) ?? null;
}

/**
 * Keep the chunk at a place: the diff stops calling it a change, and the
 * record is told the words have been looked at.
 *
 * What acceptChunk does, done here rather than called, because the change it
 * makes to the text the diff is against is the one thing needed to do it
 * backwards, and it does not hand that out.
 */
function keep(view: EditorView, pos: number): boolean {
	const chunk = chunkAt(view, pos);
	if (!chunk) return false;
	const was = getOriginalDoc(view.state);
	let insert = view.state.sliceDoc(chunk.fromB, Math.max(chunk.fromB, chunk.toB - 1));
	if (chunk.fromB !== chunk.toB && chunk.toA <= was.length) insert += view.state.lineBreak;
	const changes = ChangeSet.of({ from: chunk.fromA, to: Math.min(was.length, chunk.toA), insert }, was.length);
	view.dispatch({
		effects: [
			updateOriginalDoc.of({ doc: changes.apply(was), changes }),
			decided.of({ from: chunk.fromB, to: chunk.toB, was, changes, kept: true }),
		],
		userEvent: "accept",
	});
	return true;
}

/** Put the chunk at a place back the way it was. A plain edit, saved and logged as the person's. */
const undo = (view: EditorView, pos: number): boolean => (chunkAt(view, pos) ? rejectChunk(view, pos) : false);

/** A keeping, run backwards — and backwards again, which is how redo gets it. */
const undoable = invertedEffects.of((tr) =>
	tr.effects
		.filter((effect) => effect.is(decided))
		.flatMap((effect) => {
			const { was, changes, kept } = effect.value;
			const back = kept ? { doc: was, changes: changes.invert(was) } : { doc: changes.apply(was), changes };
			return [updateOriginalDoc.of(back), decided.of({ ...effect.value, kept: !kept })];
		}),
);

/** Every decision, however it was reached — a button, a key, ⌘Z — goes to the record from here. */
const record = (path: () => string) =>
	EditorView.updateListener.of((update) => {
		for (const tr of update.transactions) {
			for (const effect of tr.effects) {
				if (!effect.is(decided)) continue;
				const { from, to, kept } = effect.value;
				// A chunk that only took words away covers none of the note, and the
				// record has nothing there to be told about.
				if (to > from) send({ type: "accept_note", path: path(), from, to, kept });
			}
		}
	});

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

/**
 * The buttons on a chunk, wearing the same chrome as every other button here.
 *
 * Keeping is ours, so the offered action is not used for it; the chunk is
 * found from where the button sits, which is inside it.
 */
const control = (kind: "accept" | "reject", act: (e: MouseEvent) => void): HTMLElement => {
	const button = document.createElement("button");
	button.className = buttonVariants({ variant: kind === "accept" ? "secondary" : "ghost", size: "xs" });
	button.textContent = kind === "accept" ? "Keep" : "Undo";
	button.onclick = (event) => {
		// findFromDOM looks for the content inside what it is given rather than
		// walking up from it, so it wants the editor and not the button in it.
		const editor = kind === "accept" ? button.closest<HTMLElement>(".cm-editor") : null;
		const view = editor && EditorView.findFromDOM(editor);
		if (!view) return act(event);
		event.preventDefault();
		keep(view, view.posAtDOM(button));
	};
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

const here = (run: (view: EditorView, pos: number) => boolean): Command => (view) => run(view, view.state.selection.main.head);

/** Mod-Enter while a diff is open: keep the chunk under the cursor; no when there is none there. */
export const keepChunk: Command = here(keep);
/** Mod-Backspace while a diff is open: put the chunk under the cursor back; no when there is none there. */
export const undoChunk: Command = here(undo);
/** Escape while a diff is open: put the diff away; no when none is. */
export const closeDiff: Command = (v) => (reviewing(v) ? (showDiff(v, null), true) : false);

/** The diff's room, its look, its undo and its record. The keys are bound with the editor's others (Editor.tsx), in one order. */
export const review = (path: () => string): Extension => [room.of([]), style, undoable, record(path)];
