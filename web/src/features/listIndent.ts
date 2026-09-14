/**
 * A list item's wrapped lines start where its words do, not under its
 * marker.
 *
 * A hanging indent, as Obsidian has it and as CSS has always had it: the
 * indent is a fixed unit per level of nesting, every line of an item is
 * padded by that much, and its first row is pulled back by exactly as much
 * with a negative text-indent. The two come from one variable, so they
 * cannot differ — and they must not: the editor draws a selection from the
 * content's edge plus the first line's padding less its text-indent, so a
 * line whose two are not equal and opposite shifts the whole band when it
 * is the first on screen. That is also why the indent is not on a wrapper
 * around the item: the marker has to be pulled into it from the line.
 *
 * The pulled-back row is filled by boxes, not by padding: the leading
 * spaces in one box as wide as the levels above the item, and the marker —
 * bullet or number and the space after, or a task's checkbox — in a box one
 * unit wide. The words then start at the same place on every row. A line
 * of an item that has no marker of its own — a second paragraph, or a lazy
 * continuation — has its spaces in a box as wide as the whole indent. The
 * boxes are widths, not measurements: nothing here depends on the font,
 * and nothing spans a line break, so a view plugin builds it over the
 * visible lines from the tree. The space boxes are atomic — the cursor
 * steps over an indent, as over a bullet.
 *
 * A task's box holds the checkbox too — the bullet is hidden there, the
 * box being the marker — and the checkbox is made one unit wide, so the
 * box is still one unit and the wrapped rows still meet the words.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { indentWidth, markerOf } from "./listTree.ts";

/** One level of nesting, in em. Wide enough for `10. `; a longer number just runs over. */
const UNIT = 1.5;

const prefix = Decoration.mark({ class: "cm-list-prefix" });
const indentFor = new Map<number, Decoration>();
/** The box the leading spaces sit in, `width` units wide; a width of zero still takes the spaces out of the row. */
const indentBox = (width: number) => {
	let d = indentFor.get(width);
	if (!d) {
		d = Decoration.mark({ class: "cm-list-indent", attributes: { style: `--indent-width:${width * UNIT}em` } });
		indentFor.set(width, d);
	}
	return d;
};
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

/**
 * The lines of list items between `from` and `to`, each with its depth,
 * and, on the lines that carry a marker, where its content starts —
 * past a task's box, since `- [ ] ` is the prefix there, not `- `.
 *
 * A line of an item that has no marker of its own counts as the item's
 * only if it is indented to where the item's words start. Markdown lets a
 * paragraph go on under an item unindented — a lazy line — and the text
 * typed right under a list, with no blank line between, is one: the tree
 * puts it inside the last item. Drawn as the item's it would sit under
 * the words, indented, while the note has it at the margin; so such a
 * line takes the depth of the outermost item it is indented for, and none
 * when it is not indented at all.
 *
 * A marker counts once the space after it is typed. Markdown has a bare
 * `-` or `1.` on a line as an empty item already, but to someone typing
 * it is the first character of `-1` or `--` as often as of an item, and a
 * dot that came and went would be noise; so, as Typora and Obsidian have
 * it, `-` is a dash and `- ` is the item.
 */
export function listItemLines(state: EditorState, from: number, to: number): { level: Map<number, number>; markAt: Map<number, number> } {
	const { doc } = state;
	const level = new Map<number, number>();
	const markAt = new Map<number, number>();
	let depth = 0;
	syntaxTree(state).iterate({
		from,
		to,
		enter: (node) => {
			if (node.name !== "ListItem") return;
			const marker = markerOf(state, node.node);
			if (marker && !marker.spaced) return false;
			depth++;
			// The column the item's words start at: past the marker and its space.
			const content = marker ? marker.prefixEnd - marker.line.from : 0;
			if (marker) markAt.set(marker.line.number, marker.contentStart);
			const first = doc.lineAt(Math.max(node.from, from)).number;
			const last = doc.lineAt(Math.min(node.to, to)).number;
			for (let n = first; n <= last; n++) {
				if (n !== marker?.line.number && indentWidth(doc.line(n)) < content) continue;
				level.set(n, depth);
			}
		},
		leave: (node) => {
			if (node.name === "ListItem") depth--;
		},
	});
	return { level, markAt };
}

/**
 * The list lines between `from` and `to`: the indent per level on the line,
 * the leading spaces in their box, and the marker's box on the line that
 * has one. `atoms` is the space boxes, for cursor motion to step over. In a
 * quote the line opens with `>`, not spaces, so there is no space box and
 * the quote's mark sits in the marker's box, hidden with it off the cursor.
 */
export function listLines(state: EditorState, from: number, to: number): { deco: DecorationSet; atoms: DecorationSet } {
	const { doc } = state;
	const { level, markAt } = listItemLines(state, from, to);
	const deco = [];
	const atoms = [];
	for (const [n, lvl] of level) {
		const l = doc.line(n);
		const end = markAt.get(n);
		const marker = end !== undefined;
		deco.push(line(lvl, marker).range(l.from));
		const indent = indentWidth(l);
		if (indent > 0) {
			const box = indentBox(marker ? lvl - 1 : lvl).range(l.from, l.from + indent);
			deco.push(box);
			atoms.push(box);
		}
		if (marker && end > l.from + indent) deco.push(prefix.range(l.from + indent, end));
	}
	return { deco: Decoration.set(deco, true), atoms: Decoration.set(atoms, true) };
}

export const listIndent: Extension = [
	ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			atoms: DecorationSet;
			constructor(view: EditorView) {
				({ deco: this.decorations, atoms: this.atoms } = this.build(view));
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) ({ deco: this.decorations, atoms: this.atoms } = this.build(u.view));
			}
			build(view: EditorView) {
				const deco = [];
				const atoms = [];
				for (const { from, to } of view.visibleRanges) {
					const part = listLines(view.state, from, to);
					for (const it = part.deco.iter(); it.value; it.next()) deco.push(it.value.range(it.from, it.to));
					for (const it = part.atoms.iter(); it.value; it.next()) atoms.push(it.value.range(it.from, it.to));
				}
				return { deco: Decoration.set(deco, true), atoms: Decoration.set(atoms, true) };
			}
		},
		{ decorations: (p) => p.decorations, provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atoms ?? Decoration.none) },
	),
	EditorView.baseTheme({
		// Two classes: the editor's theme sets `.cm-line { padding: 0 }`, and this
		// has to outweigh it. The padding and the text-indent are one value with
		// opposite signs, from one variable, on every list line: see the top.
		".cm-line.cm-list-line": { paddingLeft: "var(--list-indent)", textIndent: "calc(-1 * var(--list-indent))" },
		// The spaces' box is a width, not a minimum: eight spaces are as wide as
		// two levels. The spaces overflow it unseen, being spaces.
		".cm-list-indent": { display: "inline-block", width: "var(--indent-width)", whiteSpace: "pre", textIndent: "0" },
		".cm-list-prefix": { display: "inline-block", minWidth: `${UNIT}em`, textIndent: "0" },
		// The checkbox's span as the whole marker: one unit, box and gap together,
		// so the caret after it is where the words start.
		".cm-line.cm-list-marker .cm-task-box": { display: "inline-block", width: `${UNIT}em`, textIndent: "0" },
		".cm-line.cm-list-marker .cm-task": { width: "1em", height: "1em", boxSizing: "border-box" },
		// Likewise the dot a bullet is drawn as (livePreview.ts): the marker and
		// its space, one unit. `text-indent` inherits, and the line's pulls a
		// first row back one unit: without its own, the dot's box would stay put
		// and the dot inside it would be drawn one unit out to the left.
		".cm-line.cm-list-marker .cm-bullet": { display: "inline-block", width: `${UNIT}em`, textIndent: "0" },
		// A number likewise, at the left of a box at least one unit wide: `10.`
		// runs over, and the words after it start where it ends. As a widget
		// rather than text, the caret after it stands at the box's edge, where
		// the words start, not at the end of `2.` inside it.
		".cm-line.cm-list-marker .cm-number": { display: "inline-block", minWidth: `${UNIT}em`, textIndent: "0", whiteSpace: "pre" },
	}),
];
