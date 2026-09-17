/**
 * Reading a list off the syntax tree, for whoever needs it: the keys
 * (listEdit.ts), the numbering (listNumbers.ts) and the drawing
 * (listIndent.ts, livePreview.ts) all ask the same questions — which
 * item is this line's, where does its marker end, how deep is it — and
 * used to answer them each in their own words. They are answered here,
 * once, as pure functions of the state and the tree.
 *
 * `tree` is the state's unless a fuller one is passed: ensureSyntaxTree
 * returns one without putting it in the state, so a caller that parsed
 * further hands its tree on.
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Line } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

/** How many characters of spaces and tabs a line opens with. */
export const indentWidth = (line: { text: string }): number => /^[ \t]*/.exec(line.text)![0].length;

/** The lines a node spans, first to last. */
export function linesOf(state: EditorState, node: { from: number; to: number }): Line[] {
	const out: Line[] = [];
	const first = state.doc.lineAt(node.from).number;
	const last = state.doc.lineAt(node.to).number;
	for (let n = first; n <= last; n++) out.push(state.doc.line(n));
	return out;
}

/** The list item whose line `pos` is on, if any: the innermost one, found past the line's indentation. */
export function itemAt(state: EditorState, pos: number, tree: Tree = syntaxTree(state)): SyntaxNode | null {
	const line = state.doc.lineAt(pos);
	let node: SyntaxNode | null = tree.resolveInner(line.from + indentWidth(line), 1);
	while (node && node.name !== "ListItem") node = node.parent;
	return node;
}

export const isList = (n: SyntaxNode | null): boolean => n !== null && (n.name === "BulletList" || n.name === "OrderedList");

/** The outermost list around `item`: the block whose numbers a change touches. */
export function blockOf(item: SyntaxNode): SyntaxNode {
	let top: SyntaxNode = item;
	for (let n: SyntaxNode | null = item; n; n = n.parent) if (isList(n)) top = n;
	return top;
}

/** The block around `pos`, if any: found from the item there, or — on a line of the block that is no item's, such as one just emptied — from the list itself. */
export function blockAt(state: EditorState, pos: number, tree: Tree = syntaxTree(state)): SyntaxNode | null {
	let top: SyntaxNode | null = null;
	for (let n: SyntaxNode | null = itemAt(state, pos, tree) ?? tree.resolveInner(pos, -1); n; n = n.parent) if (isList(n)) top = n;
	return top;
}

/** The item `item` is nested in, or null at the top of the block. */
export function parentOf(item: SyntaxNode): SyntaxNode | null {
	const list = item.parent;
	return list && isList(list) && list.parent?.name === "ListItem" ? list.parent : null;
}

/** How far into its line the marker line of `item` is indented, in characters. */
export const indentOf = (state: EditorState, item: SyntaxNode): number => indentWidth(state.doc.lineAt(item.from));

/**
 * The marker of `item`, taken apart: the `ListMark` node and its text
 * (`-`, `3.`), the task's `TaskMarker` when the item is one, whether the
 * space after the marker is there — the marker counts as an item's once
 * it is, as Typora and Obsidian have it: `-` is a dash, `- ` the item —
 * and where the content starts: past the task's box, and the space after
 * either. `prefixEnd` is where the marker's own box ends, before any task.
 */
export type Marker = { line: Line; mark: SyntaxNode; text: string; task: SyntaxNode | null; spaced: boolean; prefixEnd: number; contentStart: number };

export function markerOf(state: EditorState, item: SyntaxNode): Marker | null {
	const mark = item.getChild("ListMark");
	if (!mark) return null;
	const { doc } = state;
	const spaced = doc.sliceString(mark.to, mark.to + 1) === " ";
	const task = mark.nextSibling?.name === "Task" ? mark.nextSibling.getChild("TaskMarker") : null;
	const after = task ? task.to : mark.to;
	return {
		line: doc.lineAt(mark.from),
		mark,
		text: doc.sliceString(mark.from, mark.to),
		task,
		spaced,
		prefixEnd: spaced ? mark.to + 1 : mark.to,
		contentStart: doc.sliceString(after, after + 1) === " " ? after + 1 : after,
	};
}
