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
 * a lazy continuation — gets the padding only. Live preview hides the
 * leading spaces of every list line off the cursor (livePreview.ts), so
 * there the box holds the marker alone and the words start on the padding.
 *
 * A task's box holds the checkbox too — the bullet is hidden there, the
 * box being the marker — and the checkbox is made one unit wide, so the
 * box is still one unit and the wrapped rows still meet the words.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

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
				// Through the task's marker, when the item is one: `- [ ] ` is the prefix, not `- `.
				const task = node.node.nextSibling?.name === "Task" ? node.node.nextSibling.getChild("TaskMarker") : null;
				markAt.set(doc.lineAt(node.from).number, task ? task.to : node.to);
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

export const listIndent: Extension = [
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
		// The checkbox as the whole marker: one unit, box and gap together. On
		// the line, not the prefix box: off the cursor the whole prefix is
		// hidden or widget, so there is no text for the box to wrap.
		".cm-line.cm-list-marker .cm-task": { width: "1em", height: "1em", margin: `0 ${UNIT - 1}em 0 0`, boxSizing: "border-box" },
		// Likewise the dot a bullet is drawn as (livePreview.ts): the marker and
		// its space, one unit. `text-indent` inherits, and the line's pulls a
		// first row back one unit: without its own, the dot's box would stay put
		// and the dot inside it would be drawn one unit out to the left.
		".cm-line.cm-list-marker .cm-bullet": { display: "inline-block", width: `${UNIT}em`, textIndent: "0" },
	}),
];
