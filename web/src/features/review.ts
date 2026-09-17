/**
 * What pi changed and the person has not decided about, as a diff.
 *
 * A diff is made of two texts, and the server has both: the note as it is, and
 * the note as it would be with pi's undecided changes put back — "before",
 * read off the note's log (see unreviewed in history.ts) and sent with the
 * note whenever there is anything left to decide. This puts the editor into
 * CodeMirror's own unified merge view, which is where the work of drawing a
 * diff already is. What pi added is coloured in place; what pi removed is
 * drawn above it in a widget, because it is not in the file and must not be
 * put there.
 *
 * It is there whenever there is something to decide about, however long ago
 * pi wrote and whichever tab opens the note, and gone when there is not. There
 * is no other marking of pi's words: a mark that says "pi wrote this, decide"
 * is this, said with less.
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
import { getChunks, getOriginalDoc, originalDocChangeEffect, rejectChunk, unifiedMergeView, updateOriginalDoc } from "@codemirror/merge";
import { invertedEffects } from "@codemirror/commands";
import { ChangeSet, Compartment, EditorState, type Extension, StateEffect, Text } from "@codemirror/state";
import { type Command, EditorView } from "@codemirror/view";
import { buttonVariants } from "../components/ui/button";
import * as colour from "../changed";
import { fromServer } from "./origin";
import { flushSaves } from "../saves";
import { send } from "../ws";

/** Whether a diff is being looked over right now. */
export const reviewing = (view: EditorView): boolean => getChunks(view.state) !== null;

const room = new Compartment();

/**
 * The diff against `original`, or none, as an effect — so it can go in the
 * same transaction as the text it is about, and a note that arrives with its
 * "before" is never for a moment shown against the last one's.
 */
export const diffFor = (original: string | null): StateEffect<string | null> => setOriginal.of(original);

const setOriginal = StateEffect.define<string | null>();

/**
 * What `diffFor` comes to, worked out against the state it lands in.
 *
 * Opening and closing are a reconfiguration, because what goes in is a whole
 * extension — a diff needs its own decorations, widgets and gutter, and they
 * are only wanted while there is a diff. But a diff already open is given its
 * new "before" through the merge view's own door, `updateOriginalDoc`, and
 * not by configuring it again: a field the new configuration shares with the
 * old keeps its value, so the view's original would stay what it was first
 * given however many times the server said otherwise — and every place the
 * two then disagreed would be a chunk that was not one, or a position that
 * was not there.
 */
const takeOriginal = EditorState.transactionExtender.of((tr) => {
	const effect = tr.effects.find((e): e is StateEffect<string | null> => e.is(setOriginal));
	if (!effect) return null;
	const original = effect.value;
	const showing = getChunks(tr.startState) !== null;
	if (original === null) return showing ? { effects: room.reconfigure([]) } : null;
	if (!showing) return { effects: room.reconfigure([diff(original), open, keepUp]) };
	const was = getOriginalDoc(tr.startState);
	const doc = Text.of(original.split("\n"));
	if (was.eq(doc)) return null;
	return { effects: updateOriginalDoc.of({ doc, changes: ChangeSet.of({ from: 0, to: was.length, insert: doc }, was.length) }) };
});

/** Show the note against `original`, or close what is showing. */
export function showDiff(view: EditorView, original: string | null): void {
	view.dispatch({ effects: diffFor(original) });
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

/**
 * Every decision, however it was reached — a button, a key, ⌘Z — goes to the
 * record from here.
 *
 * Through the write barrier, because a decision is a pair of places in the
 * note and the record keeps the note as it was last written down. Type a word
 * anywhere above a chunk and press Keep inside the second the autosave waits,
 * and the places sent name the text on screen while the record still holds the
 * text on disk — every offset out by the length of what was typed. The touch
 * then lands beside the words it was about, covers nothing, and the diff comes
 * straight back: a Keep that did nothing and said nothing.
 *
 * So what is typed goes down first, as it does before a prompt and before the
 * page goes. The socket delivers in order and the server writes a save before
 * it reads the next message, so by the time the decision is read the text it
 * names is the text the record has.
 */
const record = (path: () => string) =>
	EditorView.updateListener.of((update) => {
		for (const tr of update.transactions) {
			for (const effect of tr.effects) {
				if (!effect.is(decided)) continue;
				const { from, to, kept } = effect.value;
				flushSaves();
				// Of no width when the chunk only took words away: a decision about
				// the seam where they were, which the record knows by that place.
				send({ type: "accept_note", path: path(), from, to, kept });
			}
		}
	});

/** Said on the editor while a diff is open, for anything that wants to know. */
const open = EditorView.editorAttributes.of({ class: "cm-reviewing" });

/**
 * Typing keeps the diff honest between saves.
 *
 * The merge view diffs the note against "before", and "before" comes from the
 * server after each save. In the moments between, every word typed outside
 * pi's chunks would read as a change of pi's — a green wash on the person's
 * own words for as long as the autosave takes. So a change of the person's
 * outside the chunks is made to "before" as well, in the same transaction:
 * the merge view applies that to the original before it maps the change over
 * the text, so the chunks come out as they will when the server's answer
 * lands. Inside a chunk, or across its edge, the change is left to the chunk,
 * which is what the server will say too (see unreviewed in history.ts).
 * Typing on from a chunk's very end is outside it, as there.
 */
const keepUp = EditorState.transactionExtender.of((tr) => {
	if (!tr.docChanged || tr.annotation(fromServer)) return null;
	const found = getChunks(tr.startState);
	if (!found) return null;
	const chunks = found.chunks;
	// How far a place in the text is from the same place in "before": the net
	// length of every chunk before it.
	const shift = (pos: number) => chunks.filter((c) => c.toB <= pos).reduce((n, c) => n + (c.toB - c.fromB) - (c.toA - c.fromA), 0);
	const length = getOriginalDoc(tr.startState).length;
	const specs: { from: number; to: number; insert: Text }[] = [];
	tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
		const inside = chunks.some((c) => (from === to ? c.fromB < from && from < c.endB : from < c.endB && c.fromB < to));
		if (!inside) specs.push({ from: from - shift(from), to: to - shift(to), insert: inserted });
	});
	if (!specs.length) return null;
	// If the text and "before" have come apart in a way the chunks do not
	// account for, leave "before" alone rather than guess: the server's next
	// answer sets it right, and a diff a moment out of date is nothing beside
	// a keystroke refused — an extender that throws is a key that does nothing.
	if (specs.some((c) => c.from < 0 || c.to > length || c.from > c.to)) return null;
	return { effects: originalDocChangeEffect(tr.startState, ChangeSet.of(specs, length)) };
});

/**
 * The colours of a diff, on the app's own tokens.
 *
 * The merge view's base theme colours these too, with rules like
 * `&dark.cm-merge-b .cm-changedText` — two classes deep, and a `background`
 * shorthand whose 2px gradient underline resets the colour to nothing. A
 * plain `.cm-changedText` here never reached the screen: what was drawn was
 * CodeMirror's faint default, a fifth of red under a deleted word and a thin
 * green line under an added one, which on a warm grey background is nothing a
 * person would call red or green. So these are matched a class deeper, and
 * set with the shorthand. Removed is the destructive token; added is a green
 * of its own, since the app's primary is neutral and a diff's "added" is
 * green wherever it is drawn.
 */
const style = EditorView.baseTheme({
	"&.cm-reviewing.cm-merge-b .cm-changedText": { background: colour.added, borderRadius: "2px" },
	"&.cm-reviewing.cm-merge-b .cm-deletedText": {
		background: colour.removed,
		textDecoration: "line-through",
		textDecorationColor: colour.removedRule,
		borderRadius: "2px",
	},
	"&.cm-reviewing.cm-merge-b .cm-changedLine, &.cm-reviewing .cm-inlineChangedLine": { backgroundColor: colour.addedLine },
	"&.cm-reviewing .cm-deletedChunk": { backgroundColor: colour.removedLine },
	"&.cm-reviewing .cm-deletedChunk .cm-deletedText": {
		background: colour.removed,
		textDecoration: "line-through",
		textDecorationColor: colour.removedRule,
	},
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

/** At the main cursor: a decision looks there alone, as the editor's own acceptCompletion does. */
const here = (run: (view: EditorView, pos: number) => boolean): Command => (view) => run(view, view.state.selection.main.head);

/** Mod-Enter while a diff is open: keep the chunk under the cursor; no when there is none there. */
export const keepChunk: Command = here(keep);
/** Mod-Backspace while a diff is open: put the chunk under the cursor back; no when there is none there. */
export const undoChunk: Command = here(undo);
/** Escape while a diff is open: put the diff away; no when none is. */
export const closeDiff: Command = (v) => (reviewing(v) ? (showDiff(v, null), true) : false);

/** The diff's room, its look, its undo and its record. The keys are bound with the editor's others (Editor.tsx), in one order. */
export const review = (path: () => string): Extension => [room.of([]), takeOriginal, style, undoable, record(path)];
