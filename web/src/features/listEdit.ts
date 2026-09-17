/**
 * Enter, Backspace, Tab and Shift-Tab on a list item, the way Obsidian
 * has them.
 *
 * lang-markdown offers an Enter and a Backspace, made for a code editor:
 * Enter on an empty item in a list of two moves the item down to make a
 * loose list, and Backspace turns a marker into spaces so the line can go
 * on as the item's paragraph. Nobody typing a note means either, and it
 * has no Tab at all. So the keys are written here, over the syntax tree,
 * with the item — its marker line, the lines that go on under it, and the
 * lists nested in it — as the unit that moves. The block's numbers are
 * put right by listNumbers.ts, in the same transaction as any change.
 *
 * The unit of nesting is read off the block itself, from any item already
 * nested in it, so a note written in two spaces stays in two; only a block
 * with no nesting yet takes the editor's indent unit.
 *
 * A quote's `>` is left to lang-markdown: the commands here say no outside
 * a list item, and the keymap goes on to its.
 *
 * These are editing keys, and an editing key does its work at every
 * cursor or not at all: with more than one cursor they say no, and the
 * editor's own Enter, Tab and Backspace act at each. (A key that makes a
 * decision — accepting pi's words, keeping a chunk — looks at the main
 * cursor alone, as the editor's own acceptCompletion does.)
 */
import { indentUnit, syntaxTree } from "@codemirror/language";
import { type ChangeSpec, type EditorState, EditorSelection } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";

import { blockAt, blockOf, indentOf, indentWidth, itemAt, linesOf, markerOf, parentOf } from "./listTree.ts";

// ---- Reading the block ----

/** One level of nesting, as this block has it: the indent of the first nested item past its parent's, or the editor's unit where nothing is nested yet. */
function unitOf(state: EditorState, block: SyntaxNode): string {
	let unit: string | null = null;
	block.cursor().iterate((ref) => {
		if (unit !== null) return false;
		if (ref.name !== "ListItem") return;
		const parent = parentOf(ref.node);
		if (!parent) return;
		const line = state.doc.lineAt(ref.from);
		unit = line.text.slice(indentOf(state, parent), indentOf(state, ref.node));
		return false;
	});
	return unit ?? state.facet(indentUnit);
}

// ---- Numbering ----

/**
 * The changes that number every ordered list in the block around `pos`
 * in order again: the block's own list from its first item's number, and
 * every list nested in it from 1, as Obsidian has it. Nothing is computed
 * from what moved; the block is put in order whole, so there is no case
 * to get wrong.
 */
export function renumbered(state: EditorState, pos: number, tree: Tree = syntaxTree(state)): ChangeSpec[] {
	const top = blockAt(state, pos, tree);
	if (!top) return [];
	const changes: ChangeSpec[] = [];
	top.cursor().iterate((ref) => {
		if (ref.name !== "OrderedList") return;
		const items: { digits: { from: number; to: number }; n: number }[] = [];
		for (let c = ref.node.firstChild; c; c = c.nextSibling) {
			if (c.name !== "ListItem") continue;
			const mark = c.getChild("ListMark");
			if (!mark) continue;
			const m = /^(\d+)/.exec(state.doc.sliceString(mark.from, mark.to));
			if (!m) continue;
			items.push({ digits: { from: mark.from, to: mark.from + m[1].length }, n: +m[1] });
		}
		if (items.length === 0) return;
		let expect = ref.from === top.from ? items[0].n : 1;
		for (const item of items) {
			if (item.n !== expect) changes.push({ from: item.digits.from, to: item.digits.to, insert: String(expect) });
			expect++;
		}
	});
	return changes;
}

/** Apply `changes`, the cursor going to `cursor` in the changed document's coordinates. The numbers follow (listNumbers.ts). */
function dispatchInBlock(view: EditorView, changes: ChangeSpec, cursor: number, userEvent: string) {
	view.dispatch({ changes, selection: EditorSelection.cursor(cursor), scrollIntoView: true, userEvent });
}

// ---- Moving an item ----

/** The changes that put `unit` before every line of `item` that has anything on it. */
function indented(state: EditorState, item: SyntaxNode, unit: string): ChangeSpec[] {
	return linesOf(state, item)
		.filter((l) => /\S/.test(l.text))
		.map((l) => ({ from: l.from, insert: unit }));
}

/** The changes that take up to `width` leading characters off every line of `item`. */
function outdented(state: EditorState, item: SyntaxNode, width: number): ChangeSpec[] {
	const out: ChangeSpec[] = [];
	for (const l of linesOf(state, item)) {
		const n = Math.min(width, indentWidth(l));
		if (n > 0) out.push({ from: l.from, to: l.from + n });
	}
	return out;
}

/** The cursor's item, when there is one cursor and it is on an item. */
function single(view: EditorView): { item: SyntaxNode; head: number } | null {
	const { selection } = view.state;
	if (selection.ranges.length !== 1 || !selection.main.empty) return null;
	const item = itemAt(view.state, selection.main.head);
	return item ? { item, head: selection.main.head } : null;
}

/**
 * Tab: the item goes under the item before it, children and all. The
 * first item of a list has nothing to go under, so nothing happens — the
 * key is used up all the same, since a tab typed into a list is never
 * wanted as text.
 */
export const indentListItem: Command = (view) => {
	const at = single(view);
	if (!at) return false;
	const { item, head } = at;
	if (item.prevSibling?.name !== "ListItem") return true;
	const unit = unitOf(view.state, blockOf(item));
	dispatchInBlock(view, indented(view.state, item, unit), head + unit.length, "input.indent");
	return true;
};

/** Shift-Tab: the item comes out a level, children and all; at the top of the block there is nowhere to go. */
export const outdentListItem: Command = (view) => {
	const at = single(view);
	if (!at) return false;
	const { item, head } = at;
	const parent = parentOf(item);
	if (!parent) return true;
	const width = indentOf(view.state, item) - indentOf(view.state, parent);
	const changes = view.state.changes(outdented(view.state, item, width));
	dispatchInBlock(view, changes, changes.mapPos(head, -1), "delete.dedent");
	return true;
};

// ---- Enter and Backspace ----

/**
 * Enter on an item's marker line splits the item there: what follows the
 * cursor, less the space before it, opens a new item with the same marker
 * — and an empty box, when the item is a task. An empty item is the end
 * of the list at that level: nested, it comes out a level; at the top,
 * its marker goes and the line is plain. On a line of the item that
 * carries no marker, Enter goes on with that line's indent.
 */
export const listEnter: Command = (view) => {
	const at = single(view);
	if (!at) return false;
	const { state } = view;
	const { item, head } = at;
	const marker = markerOf(state, item);
	if (!marker) return false;
	const { line, text, task, contentStart } = marker;
	const cursorLine = state.doc.lineAt(head);
	if (cursorLine.number !== line.number) {
		const indent = cursorLine.text.slice(0, indentWidth(cursorLine));
		dispatchInBlock(view, { from: head, insert: state.lineBreak + indent }, head + 1 + indent.length, "input");
		return true;
	}
	if (head < contentStart) return false;
	const empty = !/\S/.test(line.text.slice(contentStart - line.from)) && item.to <= line.to;
	if (empty) {
		if (parentOf(item)) return outdentListItem(view);
		dispatchInBlock(view, { from: line.from, to: line.to }, line.from, "delete");
		return true;
	}
	let from = head;
	while (from > contentStart && /\s/.test(line.text[from - line.from - 1])) from--;
	let to = head;
	while (to < line.to && /\s/.test(line.text[to - line.from])) to++;
	const insert = state.lineBreak + line.text.slice(0, indentOf(state, item)) + text + " " + (task ? "[ ] " : "");
	dispatchInBlock(view, { from, to, insert }, from + insert.length, "input");
	return true;
};

/** Backspace right after an item's marker takes the marker and the indent before it off together, and the line is plain. */
export const listBackspace: Command = (view) => {
	const at = single(view);
	if (!at) return false;
	const marker = markerOf(view.state, at.item);
	if (!marker || at.head !== marker.contentStart) return false;
	dispatchInBlock(view, { from: marker.line.from, to: at.head }, marker.line.from, "delete");
	return true;
};
