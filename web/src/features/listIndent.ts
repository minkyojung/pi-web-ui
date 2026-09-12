/**
 * A list item's wrapped lines start where its words do, not under its
 * marker.
 *
 * Done the way Obsidian does it, without measuring anything: the indent is
 * a fixed unit per level of nesting, every line of an item gets that much
 * padding, and the line that carries the marker pulls its first row back by
 * one unit and draws the marker — indentation, bullet or number, and the
 * space after — in a box exactly one unit wide. The words then start at the
 * same place on every row. Nothing here depends on the font, or on whether
 * live preview has hidden the marker, and nothing spans a line break, so a
 * view plugin builds it over the visible lines from the tree.
 *
 * A line of an item that has no marker of its own — a second paragraph, or
 * a lazy continuation — gets the padding only; its leading spaces stay as
 * they are, so the cursor moves the way the text reads.
 */
import { indentLess, indentMore } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type ChangeSpec, type EditorState, type Extension, Prec, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** One level of nesting, in em. Wide enough for `10. `; a longer number just runs over. */
const UNIT = 1.5;

const prefix = Decoration.mark({ class: "cm-list-prefix" });
const lineFor = new Map<string, Decoration>();
/**
 * The line's indent as a CSS variable rather than a padding, so a quote's
 * own padding (livePreview.ts) can add it to its bar instead of losing to it.
 */
const line = (level: number, marker: boolean) => {
	const key = `${level}${marker ? "m" : ""}`;
	let d = lineFor.get(key);
	if (!d) {
		d = Decoration.line({
			class: marker ? "cm-list-line cm-list-marker" : "cm-list-line",
			attributes: { style: `--list-indent:${level * UNIT}em` },
		});
		lineFor.set(key, d);
	}
	return d;
};

/** The list lines between `from` and `to`: padding per level, and the marker's box on the line that has one. */
export function listLines(state: EditorState, from: number, to: number): DecorationSet {
	const { doc } = state;
	const level = new Map<number, number>();
	const markAt = new Map<number, number>();
	let depth = 0;
	syntaxTree(state).iterate({
		from,
		to,
		enter: (node) => {
			if (node.name === "ListItem") {
				depth++;
				const first = doc.lineAt(Math.max(node.from, from)).number;
				const last = doc.lineAt(Math.min(node.to, to)).number;
				for (let n = first; n <= last; n++) level.set(n, depth);
			} else if (node.name === "ListMark") {
				markAt.set(doc.lineAt(node.from).number, node.to);
			}
		},
		leave: (node) => {
			if (node.name === "ListItem") depth--;
		},
	});
	const out = [];
	for (const [n, lvl] of level) {
		const l = doc.line(n);
		const markEnd = markAt.get(n);
		out.push(line(lvl, markEnd !== undefined).range(l.from));
		if (markEnd === undefined) continue;
		const end = doc.sliceString(markEnd, markEnd + 1) === " " ? markEnd + 1 : markEnd;
		if (end > l.from) out.push(prefix.range(l.from, end));
	}
	return Decoration.set(out, true);
}

// ---- Tab and Shift-Tab on an item ----

/** The list item whose line `pos` is on, if any: the innermost one, found past the line's indentation. */
function itemAt(state: EditorState, pos: number): SyntaxNode | null {
	const line = state.doc.lineAt(pos);
	const start = line.from + /^\s*/.exec(line.text)![0].length;
	let node: SyntaxNode | null = syntaxTree(state).resolveInner(start, 1);
	while (node && node.name !== "ListItem") node = node.parent;
	return node;
}

/**
 * The changes that number every ordered list in the block around `pos`
 * in order again, after an item moved: each list from its first item's
 * number, as lang-markdown numbers a list on Enter — except the list the
 * moved item now opens alone, which starts at 1, as Obsidian has it. Any
 * gap in the block after a move is the move's doing, so nothing is spared.
 */
export function renumbered(state: EditorState, pos: number): ChangeSpec[] {
	const moved = itemAt(state, pos);
	if (!moved) return [];
	let top: SyntaxNode = moved;
	for (let n: SyntaxNode | null = moved; n; n = n.parent) if (n.name === "OrderedList" || n.name === "BulletList") top = n;
	const changes: ChangeSpec[] = [];
	top.cursor().iterate((ref) => {
		if (ref.name !== "OrderedList") return;
		const items: { node: SyntaxNode; digits: { from: number; to: number }; n: number }[] = [];
		for (let c = ref.node.firstChild; c; c = c.nextSibling) {
			if (c.name !== "ListItem") continue;
			const mark = c.getChild("ListMark");
			if (!mark) continue;
			const text = state.doc.sliceString(mark.from, mark.to);
			const m = /^(\d+)/.exec(text);
			if (!m) continue;
			items.push({ node: c, digits: { from: mark.from, to: mark.from + m[1].length }, n: +m[1] });
		}
		if (items.length === 0) return;
		const fresh = items[0].node.from === moved.from && items.length === 1;
		let expect = fresh ? 1 : items[0].n;
		for (const item of items) {
			if (item.n !== expect) changes.push({ from: item.digits.from, to: item.digits.to, insert: String(expect) });
			expect++;
		}
	});
	return changes;
}

/** Move the item under the cursor one level in (`indentMore`) or out (`indentLess`), then number the lists again, as one change. */
function moveItem(by: typeof indentMore): (view: EditorView) => boolean {
	return (view) => {
		const { state } = view;
		if (!itemAt(state, state.selection.main.head)) return false;
		let first: Transaction | null = null;
		if (!by({ state, dispatch: (tr) => (first = tr) }) || !first) return false;
		const moved: Transaction = first;
		const s1 = moved.state;
		const head = moved.newSelection.main.head;
		// The whole block has to be parsed for the numbers to be right; a note's lists are short.
		ensureSyntaxTree(s1, s1.doc.lineAt(head).to, 100);
		const second = s1.changes(renumbered(s1, head));
		view.dispatch({
			changes: moved.changes.compose(second),
			selection: moved.newSelection.map(second),
			scrollIntoView: true,
			userEvent: "input.indent",
		});
		return true;
	};
}

export const indentListItem = moveItem(indentMore);
export const outdentListItem = moveItem(indentLess);

export const listIndent: Extension = [
	// Above indentWithTab, which gets Tab everywhere else. Only on a list item: elsewhere these say no.
	Prec.high(keymap.of([
		{ key: "Tab", run: indentListItem },
		{ key: "Shift-Tab", run: outdentListItem },
	])),
	ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view);
			}
			build(view: EditorView) {
				const out = [];
				for (const { from, to } of view.visibleRanges) {
					const it = listLines(view.state, from, to).iter();
					for (; it.value; it.next()) out.push(it.value.range(it.from, it.to));
				}
				return Decoration.set(out, true);
			}
		},
		{ decorations: (p) => p.decorations },
	),
	EditorView.baseTheme({
		// Two classes: the editor's theme sets `.cm-line { padding: 0 }`, and this has to outweigh it.
		".cm-line.cm-list-line": { paddingLeft: "var(--list-indent)" },
		".cm-line.cm-list-marker": { textIndent: `-${UNIT}em` },
		".cm-list-prefix": { display: "inline-block", minWidth: `${UNIT}em`, textIndent: "0" },
	}),
];
