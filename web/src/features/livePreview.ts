/**
 * Markup hidden where the cursor is not — Obsidian's Live Preview.
 *
 * One rule: a node keeps its markup while any selection range touches it,
 * and hides it otherwise — except a list's, which is the block's shape
 * rather than a word's dress: a bullet, a task's box and an item's
 * indentation stay drawn with the cursor on the line, as Obsidian has
 * them, since shown as text they would move the whole line. The keys
 * edit them (listEdit.ts), and Mod-e shows them as written. Two halves,
 * as CodeMirror divides them:
 *
 * - In the lines (`hidden`, `inline`): headings, emphasis, links; a
 *   quote's `>`, a bullet, a number, a task's box, an item's indentation,
 *   and the classes a code line or a done task wears. None of it changes
 *   which lines there are, so a view plugin builds it over the visible
 *   lines only, and again when the selection moves — cheaply, since the
 *   visible lines are few. Its widgets are atomic: the cursor steps over a
 *   checkbox, not into it.
 * - Of the lines (`blocks`): a fence line taken out whole, a rule drawn in
 *   a line's place, and the elements around a code block's or a quote's
 *   lines. These change the vertical layout, which the docs allow only
 *   from a state field — a plugin's decorations are computed after the
 *   viewport is — so this half is one, over the whole note, rebuilt when
 *   the note or the tree changes, or the selection moves to other lines;
 *   not when it moves along a line. A quote is a block wrapper — one
 *   element around its lines, with the bar on it — so a quote in a quote
 *   is a bar in a bar.
 *
 * All three are pure functions of the state and the ranges, so they are
 * pinned in node without a browser; the plugin and the field only call
 * them. The layer sits in a compartment so Mod-e takes it out and puts it
 * back — source mode and live preview, as Obsidian has them.
 *
 * Mod-Enter on a task line ticks its box (`toggleTask`); the key is bound
 * with the editor's others in Editor.tsx, after the diff's and pi's uses
 * of it, in one order.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Compartment, type EditorState, type Extension, type Range, type RangeSet, RangeSetBuilder, type SelectionRange, StateField, type Transaction } from "@codemirror/state";
import { BlockWrapper, Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { listItemLines } from "./listIndent.ts";
import { markerOf } from "./listTree.ts";

const hide = Decoration.replace({});

/** The nodes whose markup is hidden, and which of their children is the markup. */
const MARKUP: Record<string, Set<string>> = {
	ATXHeading1: new Set(["HeaderMark"]),
	ATXHeading2: new Set(["HeaderMark"]),
	ATXHeading3: new Set(["HeaderMark"]),
	ATXHeading4: new Set(["HeaderMark"]),
	ATXHeading5: new Set(["HeaderMark"]),
	ATXHeading6: new Set(["HeaderMark"]),
	SetextHeading1: new Set(["HeaderMark"]),
	SetextHeading2: new Set(["HeaderMark"]),
	Emphasis: new Set(["EmphasisMark"]),
	StrongEmphasis: new Set(["EmphasisMark"]),
	Strikethrough: new Set(["StrikethroughMark"]),
	InlineCode: new Set(["CodeMark"]),
	Link: new Set(["LinkMark", "URL", "LinkTitle"]),
	WikiLink: new Set(["WikiLinkMark"]),
	Highlight: new Set(["HighlightMark"]),
	Comment: new Set(["CommentMark"]),
	/** `\*`: the backslash is the mark; the node has no children, so it is handled by hand below. */
	Escape: new Set(),
};

const touches = (ranges: readonly SelectionRange[], from: number, to: number) =>
	ranges.some((r) => r.from <= to && r.to >= from);

/**
 * Obsidian's callout: a quote whose first line opens with `[!type]`, and
 * maybe a `+` or `-` after it. Not a syntax of its own — the parser reads
 * the marker as a link, and the type is only a word — so it is read here,
 * from the quote's first paragraph, by both halves: the block half draws
 * the quote as a callout, and the inline half leaves the marker's brackets
 * to it.
 */
export function calloutOf(state: EditorState, quote: SyntaxNodeRef): { type: string; from: number; to: number } | null {
	const para = quote.node.firstChild?.nextSibling;
	if (para?.name !== "Paragraph") return null;
	const m = /^\[!([\w-]+)\][+-]? ?/.exec(state.doc.sliceString(para.from, state.doc.lineAt(para.from).to));
	return m ? { type: m[1].toLowerCase(), from: para.from, to: para.from + m[0].length } : null;
}

/** Whether this link is the `[!type]` that opens a callout: the block half draws that. */
function isCalloutMark(state: EditorState, link: SyntaxNodeRef): boolean {
	const para = link.node.parent;
	const quote = para?.parent;
	if (para?.name !== "Paragraph" || quote?.name !== "Blockquote" || link.from !== para.from) return false;
	return calloutOf(state, quote) !== null;
}

/**
 * The markup to hide between `from` and `to`, given the selection: every
 * mark of a node the selection does not touch. A heading's mark takes the
 * space after it too, so the words start where the `#` did. A wikilink with
 * an alias hides its target along with the brackets, leaving the alias.
 */
export function hidden(state: EditorState, from: number, to: number, ranges = state.selection.ranges): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const tree = ensureSyntaxTree(state, to, 50) ?? syntaxTree(state);
	tree.iterate({
		from,
		to,
		enter: (node: SyntaxNodeRef) => {
			const marks = MARKUP[node.name];
			if (!marks) return;
			if (node.name === "Link" && isCalloutMark(state, node)) return false;
			if (touches(ranges, node.from, node.to)) return false;
			if (node.name === "Escape") {
				builder.add(node.from, node.from + 1, hide);
				return false;
			}
			const aliased = node.name === "WikiLink" && node.node.getChild("WikiLinkAlias") !== null;
			for (let c = node.node.firstChild; c; c = c.nextSibling) {
				const target = aliased && c.name === "WikiLinkTarget";
				if (!marks.has(c.name) && !target) continue;
				let end = c.to;
				if (c.name === "HeaderMark" && state.doc.sliceString(end, end + 1) === " ") end++;
				builder.add(c.from, end, hide);
			}
			return false;
		},
	});
	return builder.finish();
}

/** The decorations in the visible lines, `hidden` and `inline` together, and the widgets among them for the cursor to step over. */
function build(view: EditorView): { deco: DecorationSet; atoms: DecorationSet } {
	const deco: Range<Decoration>[] = [];
	const atoms: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		for (const it = hidden(view.state, from, to).iter(); it.value; it.next()) deco.push(it.value.range(it.from, it.to));
		const part = inline(view.state, from, to);
		for (const it = part.deco.iter(); it.value; it.next()) deco.push(it.value.range(it.from, it.to));
		for (const it = part.atoms.iter(); it.value; it.next()) atoms.push(it.value.range(it.from, it.to));
	}
	return { deco: Decoration.set(deco, true), atoms: Decoration.set(atoms, true) };
}

const plugin = ViewPlugin.fromClass(
	class {
		deco: DecorationSet;
		atoms: DecorationSet;
		constructor(view: EditorView) {
			({ deco: this.deco, atoms: this.atoms } = build(view));
		}
		update(u: ViewUpdate) {
			// A selection moved mid-composition is left alone: replacing the
			// DOM under a half-typed syllable would end the composition.
			const moved = u.selectionSet && !u.view.composing;
			if (u.docChanged || u.viewportChanged || moved || syntaxTree(u.startState) !== syntaxTree(u.state)) {
				({ deco: this.deco, atoms: this.atoms } = build(u.view));
			}
		}
	},
	{ decorations: (p) => p.deco, provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atoms ?? Decoration.none) },
);

// ---- The block half ----

const codeLine = Decoration.line({ class: "cm-code-line" });
/** A fence line taken out of the layout whole, off the block's lines: a block replace, drawing nothing. */
const fenceGone = Decoration.replace({ block: true });
const codeWrappers = new Map<string, BlockWrapper>();
/** The element around a code block's lines, carrying the language for the CSS to show. */
const codeWrapper = (lang: string) => {
	let w = codeWrappers.get(lang);
	if (!w) {
		w = BlockWrapper.create({ tagName: "div", attributes: lang ? { class: "cm-code", "data-lang": lang } : { class: "cm-code" } });
		codeWrappers.set(lang, w);
	}
	return w;
};
const doneLine = Decoration.line({ class: "cm-task-done" });
const calloutTitles = new Map<string, Decoration>();
/** A callout's first line, which carries the type for the CSS to show before the title. */
const calloutTitle = (type: string) => {
	let d = calloutTitles.get(type);
	if (!d) {
		d = Decoration.line({ class: "cm-callout-title", attributes: { "data-callout": type } });
		calloutTitles.set(type, d);
	}
	return d;
};
/**
 * The element around a quote's lines. Depth sets the rank, so the outer
 * quote is the outer element when two start on the same line; a callout is
 * a quote with a class and its type.
 */
const quoteWrapper = (depth: number, callout: string | null) =>
	BlockWrapper.create({
		tagName: "div",
		attributes: callout ? { class: "cm-quote cm-callout", "data-callout": callout } : { class: "cm-quote" },
		rank: Math.max(0, 100 - depth),
	});

class Rule extends WidgetType {
	toDOM() {
		const el = document.createElement("hr");
		el.className = "cm-rule";
		return el;
	}
	eq() {
		return true;
	}
}

/** The dot a bullet is drawn as. One for all, since they are all alike. */
class Bullet extends WidgetType {
	toDOM() {
		const el = document.createElement("span");
		el.className = "cm-bullet";
		el.textContent = "•";
		return el;
	}
	eq() {
		return true;
	}
}
const bullet = Decoration.replace({ widget: new Bullet() });

/** A number and its dot, drawn as they are, in a box: `2.`, `10.`, `3)`. */
class Number extends WidgetType {
	readonly text: string;
	constructor(text: string) {
		super();
		this.text = text;
	}
	toDOM() {
		const el = document.createElement("span");
		el.className = "cm-number";
		el.textContent = this.text + " ";
		return el;
	}
	eq(other: Number) {
		return other.text === this.text;
	}
	ignoreEvent() {
		return false;
	}
}
const numbers = new Map<string, Decoration>();
const number = (text: string) => {
	let d = numbers.get(text);
	if (!d) {
		d = Decoration.replace({ widget: new Number(text) });
		numbers.set(text, d);
	}
	return d;
};

class Checkbox extends WidgetType {
	readonly checked: boolean;
	constructor(checked: boolean) {
		super();
		this.checked = checked;
	}
	// The box in a span one indent unit wide (listIndent.ts): the caret after
	// the widget sits at the widget's edge, and were that the input's, with
	// the gap a margin, the caret on an empty task would sit short of where
	// its words land.
	toDOM() {
		const box = document.createElement("span");
		box.className = "cm-task-box";
		const el = document.createElement("input");
		el.type = "checkbox";
		el.className = "cm-task";
		el.checked = this.checked;
		box.appendChild(el);
		return box;
	}
	eq(other: Checkbox) {
		return other.checked === this.checked;
	}
	// The click is ours (below); everything else is the editor's.
	ignoreEvent(e: Event) {
		return e.type !== "mousedown" && e.type !== "click";
	}
}

/** The rule in its line's place: a block widget, since it stands where a line would. */
const rule = Decoration.replace({ widget: new Rule(), block: true });
const boxOn = Decoration.replace({ widget: new Checkbox(true) });
const boxOff = Decoration.replace({ widget: new Checkbox(false) });

/** Whether the selection is on any line of the block. */
const onLines = (state: EditorState, ranges: readonly SelectionRange[], from: number, to: number) =>
	touches(ranges, state.doc.lineAt(from).from, state.doc.lineAt(to).to);

/** The nearest quote around `node`. */
function quoteOf(node: SyntaxNodeRef): SyntaxNode | null {
	for (let n = node.node.parent; n; n = n.parent) if (n.name === "Blockquote") return n;
	return null;
}

/** How many quotes are around `node`, itself not counted. */
function quoteDepth(node: SyntaxNodeRef): number {
	let depth = 0;
	for (let n = node.node.parent; n; n = n.parent) if (n.name === "Blockquote") depth++;
	return depth;
}

/**
 * The in-line decorations between `from` and `to`, given the selection:
 * every code line and callout title in its class, a done task's line
 * struck; and — where the selection is not — a quote's `>` and a callout's
 * marker hidden; and, cursor or not, a bullet as a dot, a number in its
 * box, a task's marker as a box, an item's indentation gone. `atoms` is
 * the widgets and the hidden indentation, for cursor motion to step over.
 */
export type Inline = { deco: DecorationSet; atoms: DecorationSet };

export function inline(state: EditorState, from: number, to: number, ranges = state.selection.ranges): Inline {
	const { doc } = state;
	const deco: Range<Decoration>[] = [];
	const atoms: Range<Decoration>[] = [];
	const put = (from: number, to: number, value: Decoration, atom = false) => {
		deco.push(value.range(from, to));
		if (atom) atoms.push(value.range(from, to));
	};
	/** The lines of fenced code, where leading spaces are the code's own. */
	const codeLines = new Set<number>();
	syntaxTree(state).iterate({
		from,
		to,
		enter: (node: SyntaxNodeRef) => {
			switch (node.name) {
				case "FencedCode": {
					// Its lines in the code face; the box around them and the fences
					// gone are the block half's.
					for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) {
						codeLines.add(n);
						put(doc.line(n).from, doc.line(n).from, codeLine);
					}
					return false;
				}
				case "Blockquote": {
					// The callout's title line, and its marker hidden off the quote;
					// the `>` marks are hidden as they come, each by its own quote
					// (QuoteMark below), so a quote in a quote is walked on into.
					const callout = calloutOf(state, node);
					if (!callout) return;
					const line = doc.lineAt(node.from);
					put(line.from, line.from, calloutTitle(callout.type));
					if (!onLines(state, ranges, node.from, node.to)) put(callout.from, callout.to, hide);
					return;
				}
				case "QuoteMark": {
					const quote = quoteOf(node);
					if (!quote || onLines(state, ranges, quote.from, quote.to)) return false;
					const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
					put(node.from, end, hide);
					return false;
				}
				case "ListItem": {
					// `-`, `*` or `+` as a dot, a number as itself, cursor or not; on
					// a task item the box is the marker, so the bullet goes and the
					// box stands where `[ ]` was, and a done task's line is dimmed and
					// struck. The item's other lines and the lists inside it are
					// walked on.
					const marker = markerOf(state, node.node);
					if (!marker || !marker.spaced) return;
					// The marker and the space after it, as one widget one indent unit
					// wide (listIndent.ts), so the words start where the wrapped rows
					// do, and the caret after it stands where they start.
					const { mark, text, task, line } = marker;
					put(mark.from, marker.prefixEnd, task ? hide : /^[-*+]$/.test(text) ? bullet : number(text), true);
					if (!task) return;
					const checked = doc.sliceString(task.from, task.to).toLowerCase() === "[x]";
					if (checked) put(line.from, line.from, doneLine);
					put(task.from, marker.contentStart, checked ? boxOn : boxOff, true);
					return;
				}
			}
		},
	});
	// A list line's leading spaces are markup — they say how deep the item
	// is, which the padding already shows — so they go, cursor or not, and
	// the words start where the padding puts them. The lines are the ones
	// listIndent.ts pads, so a lazy line under an item, which it does not,
	// keeps its spaces. Not in a fence, where the spaces are the code's.
	for (const n of listItemLines(state, from, to).level.keys()) {
		if (codeLines.has(n)) continue;
		const l = doc.line(n);
		const indent = /^[ \t]*/.exec(l.text)![0].length;
		if (indent === 0 || indent === l.length) continue;
		put(l.from, l.from + indent, hide, true);
	}
	return { deco: Decoration.set(deco, true), atoms: Decoration.set(atoms, true) };
}

/**
 * The block decorations for the whole note, the ones that change which
 * lines there are: off the selection's lines, a fence line taken out
 * whole and a rule drawn in its line's place; and the elements around a
 * code block's and a quote's lines. `atoms` is the rule, for cursor motion
 * to step over. Only the nodes that hold blocks are walked into, so the
 * walk is shallow: a paragraph's words are not looked at.
 */
export type Blocks = { deco: DecorationSet; atoms: DecorationSet; wrappers: RangeSet<BlockWrapper> };

const HOLDS_BLOCKS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

export function blocks(state: EditorState, ranges = state.selection.ranges): Blocks {
	const { doc } = state;
	const deco: Range<Decoration>[] = [];
	const atoms: Range<Decoration>[] = [];
	const wrappers: Range<BlockWrapper>[] = [];
	syntaxTree(state).iterate({
		enter: (node: SyntaxNodeRef) => {
			switch (node.name) {
				case "FencedCode": {
					// The box around the block, and — off the block's lines — the
					// fences gone from the layout, so the code sits in the box alone
					// with the language named on it.
					const info = node.node.getChild("CodeInfo");
					const first = doc.lineAt(node.from);
					const last = doc.lineAt(node.to);
					wrappers.push(codeWrapper(info ? doc.sliceString(info.from, info.to).trim() : "").range(first.from, node.to));
					if (onLines(state, ranges, node.from, node.to)) return false;
					const marks = node.node.getChildren("CodeMark");
					// The opening fence is the first line; the closing one, when it is there, is the last.
					deco.push(fenceGone.range(first.from, first.to));
					if (marks.length > 1 && doc.lineAt(marks[marks.length - 1].from).number === last.number) deco.push(fenceGone.range(last.from, last.to));
					return false;
				}
				case "Blockquote": {
					// The wrapper; a callout is a quote with a class and its type.
					const depth = quoteDepth(node);
					const callout = calloutOf(state, node);
					wrappers.push(quoteWrapper(depth, callout?.type ?? null).range(doc.lineAt(node.from).from, node.to));
					return;
				}
				case "HorizontalRule": {
					if (onLines(state, ranges, node.from, node.to)) return false;
					const line = doc.lineAt(node.from);
					deco.push(rule.range(line.from, line.to));
					atoms.push(rule.range(line.from, line.to));
					return false;
				}
				default:
					return HOLDS_BLOCKS.has(node.name);
			}
		},
	});
	return { deco: Decoration.set(deco, true), atoms: Decoration.set(atoms, true), wrappers: BlockWrapper.set(wrappers, true) };
}

/** The change that ticks or unticks the task on the line at `pos`, if there is one. */
function taskToggle(state: EditorState, pos: number): { from: number; to: number; insert: string } | null {
	const line = state.doc.lineAt(pos);
	let change: { from: number; to: number; insert: string } | null = null;
	syntaxTree(state).iterate({
		from: line.from,
		to: line.to,
		enter: (n) => {
			if (n.name !== "TaskMarker") return;
			const on = state.doc.sliceString(n.from, n.to).toLowerCase() === "[x]";
			change = { from: n.from, to: n.to, insert: on ? "[ ]" : "[x]" };
			return false;
		},
	});
	return change;
}

/** Tick or untick the task on the line of every cursor — each line once, however many cursors are on it. */
export const toggleTask = (view: EditorView) => {
	const lines = new Set<number>();
	const changes = [];
	for (const r of view.state.selection.ranges) {
		const line = view.state.doc.lineAt(r.head).number;
		if (lines.has(line)) continue;
		lines.add(line);
		const change = taskToggle(view.state, r.head);
		if (change) changes.push(change);
	}
	if (changes.length === 0) return false;
	view.dispatch({ changes, userEvent: "input" });
	return true;
};

/** The lines the selection is on, as a key: what the block half's hiding turns on, and all it turns on. */
const linesOf = (state: EditorState) => state.selection.ranges.map((r) => `${state.doc.lineAt(r.from).number}-${state.doc.lineAt(r.to).number}`).join(",");

const field = StateField.define<Blocks>({
	create: (state) => blocks(state),
	update(value, tr: Transaction) {
		if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return blocks(tr.state);
		// Along a line the selection changes nothing here; to other lines it might.
		if (tr.selection && linesOf(tr.startState) !== linesOf(tr.state)) return blocks(tr.state);
		return value;
	},
	provide: (f) => [
		EditorView.decorations.from(f, (v) => v.deco),
		EditorView.atomicRanges.of((view) => view.state.field(f).atoms),
		EditorView.blockWrappers.from(f, (v) => v.wrappers),
	],
});

const blockLayer: Extension = [
	field,
	EditorView.domEventHandlers({
		mousedown(event, view) {
			const el = event.target;
			if (!(el instanceof HTMLInputElement) || !el.classList.contains("cm-task")) return false;
			event.preventDefault();
			const change = taskToggle(view.state, view.posAtDOM(el));
			if (change) view.dispatch({ changes: change, userEvent: "input" });
			return true;
		},
	}),
	EditorView.baseTheme({
		".cm-code-line": { fontFamily: "ui-monospace, monospace", fontSize: "0.9em" },
		// The code block's element: the box is here, the face is on the lines. The
		// language sits in the corner, from the attribute, so no widget is needed.
		".cm-code": {
			position: "relative",
			backgroundColor: "color-mix(in oklab, var(--foreground) 5%, transparent)",
			borderRadius: "6px",
			padding: "0.5em 0.75em",
		},
		".cm-code[data-lang]::before": {
			content: "attr(data-lang)",
			position: "absolute",
			top: "0.3em",
			right: "0.75em",
			fontSize: "0.75em",
			color: "var(--muted-foreground)",
			fontFamily: "ui-monospace, monospace",
		},
		// The quote's element: the bar and the room for it are here, not on
		// its lines, so a quote inside a quote is a bar inside a bar, and a
		// list inside a quote keeps its own indent.
		".cm-quote": { borderLeft: "2px solid var(--border)", paddingLeft: "0.75rem" },
		// A callout is a quote with a wash and a heavier bar; its first line names the type, from the attribute, so no widget is needed.
		".cm-quote.cm-callout": { backgroundColor: "color-mix(in oklab, var(--foreground) 5%, transparent)", borderLeftColor: "var(--foreground)" },
		".cm-line.cm-callout-title": { fontWeight: "600" },
		".cm-line.cm-callout-title::before": { content: "attr(data-callout)", textTransform: "capitalize", marginRight: "0.4em" },
		".cm-rule": { border: "none", borderTop: "1px solid var(--border)", margin: "0.6em 0", display: "block" },
		".cm-task": { verticalAlign: "middle", margin: "0" },
		".cm-bullet, .cm-number": { color: "var(--muted-foreground)" },
		".cm-line.cm-task-done": { color: "var(--muted-foreground)", textDecoration: "line-through" },
	}),
];

const mode = new Compartment();
const off: Extension = [];

/** Whether the layer is on in this state; source mode when not. */
export const isLivePreview = (state: EditorState) => mode.get(state) !== off;

export const toggleLivePreview = (view: EditorView) => {
	view.dispatch({ effects: mode.reconfigure(isLivePreview(view.state) ? off : layer) });
	return true;
};

const layer: Extension = [plugin, blockLayer];

/** The layer, on. Mod-e (Editor.tsx) takes it out and puts it back. */
export const livePreview: Extension = mode.of(layer);
