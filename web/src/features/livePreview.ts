/**
 * Markup hidden where the cursor is not — Obsidian's Live Preview.
 *
 * One rule: a node keeps its markup while any selection range touches it,
 * and hides it otherwise. Two halves, as CodeMirror divides them:
 *
 * - Inline (`hidden`): headings, emphasis, links. Nothing spans a line
 *   break, so a view plugin builds it over the visible lines only.
 * - Block (`blocks`): fenced code lines, quote bars, a rule, a checkbox.
 *   Line decorations and widgets change the vertical layout, which the
 *   docs allow only from a state field, so this half is one, over the whole
 *   note, mapped through typing and rebuilt when the tree or the selection
 *   moves. Its widgets are atomic: the cursor steps over a checkbox, not
 *   into it.
 *
 * Both are pure functions of the state and the ranges, so they are pinned
 * in node without a browser; the plugin and the field only call them. The
 * layer sits in a compartment so Mod-e takes it out and puts it back —
 * source mode and live preview, as Obsidian has them.
 *
 * Mod-Enter on a task line ticks its box. The pending layer binds the same
 * key above this one and lets it through when the cursor is not on pi's
 * words, so the two do not meet.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Compartment, type EditorState, type Extension, Prec, RangeSetBuilder, type SelectionRange, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";

const hide = Decoration.replace({});

/** The nodes whose markup is hidden, and which of their children is the markup. */
const MARKUP: Record<string, Set<string>> = {
	ATXHeading1: new Set(["HeaderMark"]),
	ATXHeading2: new Set(["HeaderMark"]),
	ATXHeading3: new Set(["HeaderMark"]),
	ATXHeading4: new Set(["HeaderMark"]),
	ATXHeading5: new Set(["HeaderMark"]),
	ATXHeading6: new Set(["HeaderMark"]),
	Emphasis: new Set(["EmphasisMark"]),
	StrongEmphasis: new Set(["EmphasisMark"]),
	Link: new Set(["LinkMark", "URL", "LinkTitle"]),
	WikiLink: new Set(["WikiLinkMark"]),
	Highlight: new Set(["HighlightMark"]),
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

function build(view: EditorView): DecorationSet {
	const sets = view.visibleRanges.map(({ from, to }) => hidden(view.state, from, to));
	if (sets.length === 1) return sets[0];
	const builder = new RangeSetBuilder<Decoration>();
	for (const set of sets) {
		const it = set.iter();
		while (it.value) {
			builder.add(it.from, it.to, it.value);
			it.next();
		}
	}
	return builder.finish();
}

const plugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = build(view);
		}
		update(u: ViewUpdate) {
			// A selection moved mid-composition is left alone: replacing the
			// DOM under a half-typed syllable would end the composition.
			const moved = u.selectionSet && !u.view.composing;
			if (u.docChanged || u.viewportChanged || moved || syntaxTree(u.startState) !== syntaxTree(u.state)) {
				this.decorations = build(u.view);
			}
		}
	},
	{ decorations: (p) => p.decorations },
);

// ---- The block half ----

const codeLine = Decoration.line({ class: "cm-code-line" });
const quoteLine = Decoration.line({ class: "cm-quote-line" });
const calloutLines = new Map<string, [Decoration, Decoration]>();
/** A callout's lines, and its first line, which carries the type for the CSS to show. */
const calloutLine = (type: string) => {
	let d = calloutLines.get(type);
	if (!d) {
		d = [
			Decoration.line({ class: "cm-callout", attributes: { "data-callout": type } }),
			Decoration.line({ class: "cm-callout cm-callout-title", attributes: { "data-callout": type } }),
		];
		calloutLines.set(type, d);
	}
	return d;
};

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

class Checkbox extends WidgetType {
	readonly checked: boolean;
	constructor(checked: boolean) {
		super();
		this.checked = checked;
	}
	toDOM() {
		const el = document.createElement("input");
		el.type = "checkbox";
		el.className = "cm-task";
		el.checked = this.checked;
		return el;
	}
	eq(other: Checkbox) {
		return other.checked === this.checked;
	}
	// The click is ours (below); everything else is the editor's.
	ignoreEvent(e: Event) {
		return e.type !== "mousedown" && e.type !== "click";
	}
}

const rule = Decoration.replace({ widget: new Rule() });
const box = (checked: boolean) => Decoration.replace({ widget: new Checkbox(checked) });

/** Whether the selection is on any line of the block. */
const onLines = (state: EditorState, ranges: readonly SelectionRange[], from: number, to: number) =>
	touches(ranges, state.doc.lineAt(from).from, state.doc.lineAt(to).to);

/**
 * The block decorations for the whole note: every fenced code line and
 * quote line in its class, and — where the selection is not — a quote's
 * `>` hidden, a rule drawn as one, a task's marker drawn as a box.
 * `atoms` is the widgets alone, for cursor motion to step over.
 */
export function blocks(state: EditorState, ranges = state.selection.ranges): { deco: DecorationSet; atoms: DecorationSet } {
	const { doc } = state;
	const deco: { from: number; to: number; value: Decoration }[] = [];
	const atoms = new RangeSetBuilder<Decoration>();
	const lines = (from: number, to: number, value: Decoration) => {
		const first = state.doc.lineAt(from).number;
		const last = state.doc.lineAt(to).number;
		for (let n = first; n <= last; n++) {
			const l = state.doc.line(n);
			deco.push({ from: l.from, to: l.from, value });
		}
	};
	syntaxTree(state).iterate({
		enter: (node: SyntaxNodeRef) => {
			switch (node.name) {
				case "FencedCode":
					lines(node.from, node.to, codeLine);
					return false;
				case "Blockquote": {
					lines(node.from, node.to, quoteLine);
					const callout = calloutOf(state, node);
					if (callout) {
						const [body, title] = calloutLine(callout.type);
						lines(node.from, node.to, body);
						deco.push({ from: doc.lineAt(node.from).from, to: doc.lineAt(node.from).from, value: title });
					}
					if (onLines(state, ranges, node.from, node.to)) return false;
					if (callout) deco.push({ from: callout.from, to: callout.to, value: hide });
					// The marks of the lines after the first sit inside the paragraph, so the whole quote is walked.
					node.node.cursor().iterate((c) => {
						if (c.name !== "QuoteMark") return;
						const end = state.doc.sliceString(c.to, c.to + 1) === " " ? c.to + 1 : c.to;
						deco.push({ from: c.from, to: end, value: hide });
					});
					return false;
				}
				case "HorizontalRule":
					if (onLines(state, ranges, node.from, node.to)) return false;
					deco.push({ from: node.from, to: node.to, value: rule });
					atoms.add(node.from, node.to, rule);
					return false;
				case "Task": {
					const marker = node.node.getChild("TaskMarker");
					if (!marker || onLines(state, ranges, node.from, node.to)) return false;
					const checked = state.doc.sliceString(marker.from, marker.to).toLowerCase() === "[x]";
					const end = state.doc.sliceString(marker.to, marker.to + 1) === " " ? marker.to + 1 : marker.to;
					deco.push({ from: marker.from, to: end, value: box(checked) });
					atoms.add(marker.from, end, box(checked));
					return false;
				}
			}
		},
	});
	return { deco: Decoration.set(deco.map((d) => d.value.range(d.from, d.to)), true), atoms: atoms.finish() };
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

/** Tick or untick the task on the line of every cursor. */
export const toggleTask = (view: EditorView) => {
	const changes = view.state.selection.ranges.map((r) => taskToggle(view.state, r.head)).filter((c) => c !== null);
	if (changes.length === 0) return false;
	view.dispatch({ changes, userEvent: "input" });
	return true;
};

const field = StateField.define<{ deco: DecorationSet; atoms: DecorationSet }>({
	create: (state) => blocks(state),
	update(value, tr: Transaction) {
		if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return blocks(tr.state);
		return value;
	},
	provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), EditorView.atomicRanges.of((view) => view.state.field(f).atoms)],
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
	// Above the editor's own keys, which give Mod-Enter a blank line. The
	// pending layer's Mod-Enter is as high and listed first, so it goes first.
	Prec.high(keymap.of([{ key: "Mod-Enter", run: toggleTask }])),
	EditorView.baseTheme({
		".cm-code-line": { fontFamily: "ui-monospace, monospace", fontSize: "0.9em" },
		// Two classes, so this outweighs listIndent's padding and adds its indent to the bar's.
		".cm-line.cm-quote-line": { borderLeft: "2px solid var(--border)", paddingLeft: "calc(0.75rem + var(--list-indent, 0em))" },
		// A callout is a quote with a wash and a heavier bar; its first line names the type, from the attribute, so no widget is needed.
		".cm-line.cm-callout": { backgroundColor: "color-mix(in oklab, var(--foreground) 5%, transparent)", borderLeftColor: "var(--foreground)" },
		".cm-line.cm-callout-title": { fontWeight: "600" },
		".cm-line.cm-callout-title::before": { content: "attr(data-callout)", textTransform: "capitalize", marginRight: "0.4em" },
		".cm-rule": { border: "none", borderTop: "1px solid var(--border)", margin: "0.6em 0", display: "block" },
		".cm-task": { verticalAlign: "middle", margin: "0 0.4em 0 0" },
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

export const livePreview: Extension = [
	mode.of(layer),
	Prec.high(keymap.of([{ key: "Mod-e", run: toggleLivePreview }])),
];
