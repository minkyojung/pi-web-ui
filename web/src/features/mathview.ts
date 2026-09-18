/**
 * Math drawn as math: `$x^2$` in a line and a `$$` block, set by KaTeX off
 * the cursor, and the source back when the cursor is in it. The parser's
 * part is math.ts. KaTeX writes its own markup and escapes what it is
 * given, so what a note says goes to innerHTML through it and nowhere
 * else; a formula it cannot set is shown as it was written, in red.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, type SelectionRange, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";

class Math extends WidgetType {
	tex: string;
	block: boolean;
	constructor(tex: string, block: boolean) {
		super();
		this.tex = tex;
		this.block = block;
	}
	eq(other: Math) {
		return this.tex === other.tex && this.block === other.block;
	}
	toDOM() {
		const el = document.createElement(this.block ? "div" : "span");
		el.className = this.block ? "cm-math cm-math-block" : "cm-math";
		el.innerHTML = katex.renderToString(this.tex, { displayMode: this.block, throwOnError: false, output: "html" });
		return el;
	}
	ignoreEvent() {
		return false;
	}
}

const touches = (ranges: readonly SelectionRange[], from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
const onLines = (state: EditorState, ranges: readonly SelectionRange[], from: number, to: number) =>
	touches(ranges, state.doc.lineAt(from).from, state.doc.lineAt(to).to);

/** The words between the marks, or the fences: what KaTeX is given. */
const texOf = (text: string, block: boolean) => (block ? text.replace(/^\$\$/, "").replace(/\$\$\s*$/, "") : text.slice(1, -1)).trim();

function inlineMath(view: EditorView): DecorationSet {
	const { state } = view;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name !== "InlineMath") return;
				if (touches(state.selection.ranges, node.from, node.to)) return false;
				out.push(Decoration.replace({ widget: new Math(texOf(state.doc.sliceString(node.from, node.to), false), false) }).range(node.from, node.to));
				return false;
			},
		});
	}
	return Decoration.set(out, true);
}

/** The blocks, from state: a decoration that replaces lines whole is one the editor takes from state only. */
function blockMath(state: EditorState): DecorationSet {
	const out: Range<Decoration>[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== "MathBlock") return;
			if (onLines(state, state.selection.ranges, node.from, node.to)) return false;
			const first = state.doc.lineAt(node.from).from;
			const last = state.doc.lineAt(node.to).to;
			out.push(Decoration.replace({ widget: new Math(texOf(state.doc.sliceString(node.from, node.to), true), true), block: true }).range(first, last));
			return false;
		},
	});
	return Decoration.set(out, true);
}

const blocks = StateField.define<DecorationSet>({
	create: blockMath,
	update(value, tr) {
		if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return blockMath(tr.state);
		return value;
	},
	provide: (f) => EditorView.decorations.from(f),
});

export const mathExtension: Extension = [
	ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = inlineMath(view);
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = inlineMath(u.view);
			}
		},
		{ decorations: (p) => p.decorations },
	),
	blocks,
	EditorView.baseTheme({
		".cm-math-block": { display: "block", textAlign: "center", padding: "0.4em 0", overflowX: "auto" },
		".cm-math .katex-error": { color: "var(--destructive)" },
	}),
];
