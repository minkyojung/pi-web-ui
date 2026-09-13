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

/**
 * The lines of list items between `from` and `to`, each with its depth,
 * and where the marker ends on the lines that carry one.
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
/** Whether the space after `mark` is there: the marker is an item's, not the head of a word. */
export const spaced = (state: EditorState, mark: { to: number }) => state.doc.sliceString(mark.to, mark.to + 1) === " ";

export function listItemLines(state: EditorState, from: number, to: number): { level: Map<number, number>; markAt: Map<number, number> } {
	const { doc } = state;
	const level = new Map<number, number>();
	const markAt = new Map<number, number>();
	let depth = 0;
	syntaxTree(state).iterate({
		from,
		to,
		enter: (node) => {
			if (node.name === "ListItem") {
				const mark = node.node.getChild("ListMark");
				if (mark && !spaced(state, mark)) return false;
				depth++;
				const markLine = mark ? doc.lineAt(mark.from) : null;
				// The column the item's words start at: past the marker and its space.
				const content = mark ? mark.to - markLine!.from + 1 : 0;
				const first = doc.lineAt(Math.max(node.from, from)).number;
				const last = doc.lineAt(Math.min(node.to, to)).number;
				for (let n = first; n <= last; n++) {
					const l = doc.line(n);
					if (n !== markLine?.number && /^[ \t]*/.exec(l.text)![0].length < content) continue;
					level.set(n, depth);
				}
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
	for (const n of markAt.keys()) if (!level.has(n)) markAt.delete(n);
	return { level, markAt };
}

/** The list lines between `from` and `to`: padding per level, and the marker's box on the line that has one. */
export function listLines(state: EditorState, from: number, to: number): DecorationSet {
	const { doc } = state;
	const { level, markAt } = listItemLines(state, from, to);
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
