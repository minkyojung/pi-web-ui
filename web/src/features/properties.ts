/**
 * The note's properties as the editor holds them, and the block kept out of
 * the way of typing.
 *
 * A field reads the block off the editor's own tree — the same parser the
 * server reads it with — and parses the YAML once per change to the block,
 * not per keystroke in the note. The panel above the note draws from it.
 *
 * In live preview the block is the panel's, not the cursor's: a selection
 * that would land in it is moved to where the text begins, and a change
 * that would touch it — the Backspace at the top of the note that would eat
 * the closing `---` — is refused. The panel's own changes, the server's,
 * and an undo pass; source mode (⌘E) lifts the guard, since there the block
 * is text like any other.
 */
import { syntaxTree } from "@codemirror/language";
import { Annotation, EditorSelection, EditorState, type Extension, StateField, type Transaction } from "@codemirror/state";

import { type Block, type Properties, propertiesIn } from "../../../properties.ts";
import { isLivePreview } from "./livePreview.ts";
import { fromServer } from "./origin.ts";

/** A change to the block made through the panel, which the guard lets through. */
export const propertiesEdit = Annotation.define<boolean>();

/** The block at the top of the note, off the editor's tree; null when there is none. */
export function blockIn(state: EditorState): Block | null {
	const first = syntaxTree(state).topNode.firstChild;
	if (!first || first.name !== "FrontMatter") return null;
	const marks = first.getChildren("FrontMatterMark");
	if (marks.length < 2) return null;
	const open = state.doc.lineAt(marks[0].to).to + 1;
	return { from: first.from, to: first.to, yaml: { from: Math.min(open, marks[1].from), to: marks[1].from } };
}

/** Where the note's text begins under the block: after the newline that closes its last line. */
export const bodyStartIn = (state: EditorState, block: Block) => Math.min(state.doc.length, block.to + (state.doc.sliceString(block.to, block.to + 1) === "\n" ? 1 : 0));

const read = (state: EditorState): Properties => {
	const block = blockIn(state);
	return propertiesIn(block ? state.doc.sliceString(0, block.to) : "", block);
};

export const propertiesField = StateField.define<Properties>({
	create: read,
	update(value, tr) {
		if (!tr.docChanged) return value;
		const block = blockIn(tr.state);
		if (!block) return value.block ? { block: null } : value;
		// The same block, letter for letter, is the same properties: typing in the note leaves them be.
		if (value.block && tr.state.doc.sliceString(block.from, block.to) === tr.startState.doc.sliceString(value.block.from, value.block.to)) return value;
		return read(tr.state);
	},
});

const passes = (tr: Transaction) => tr.annotation(propertiesEdit) || tr.annotation(fromServer) || tr.isUserEvent("undo") || tr.isUserEvent("redo");

const guard: Extension = [
	EditorState.transactionFilter.of((tr) => {
		if (!tr.selection || !isLivePreview(tr.state)) return tr;
		const block = tr.state.field(propertiesField).block;
		if (!block) return tr;
		const start = bodyStartIn(tr.state, block);
		if (tr.selection.ranges.every((r) => r.from >= start)) return tr;
		const ranges = tr.selection.ranges.map((r) => EditorSelection.range(Math.max(r.anchor, start), Math.max(r.head, start)));
		// Sequential: these positions are in the document the transaction makes,
		// not the one it starts from — the two differ when it carries changes.
		return [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true }];
	}),
	EditorState.changeFilter.of((tr) => {
		if (passes(tr) || !isLivePreview(tr.startState)) return true;
		const block = tr.startState.field(propertiesField).block;
		// Through the closing fence's newline — what a Backspace at the top of the
		// text would take. The range's end is where changes may begin again: a
		// letter typed at the top of the text is at that end, and is let through.
		return block ? [0, block.to + 1] : true;
	}),
];

/** The field and the guard, for the editor. */
export const properties: Extension = [propertiesField, guard];
