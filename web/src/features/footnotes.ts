/**
 * Footnotes drawn as footnotes: `[^id]` in the text as a small number, the
 * `[^id]:` that opens the note as the same number, and a click on either
 * goes to the other. Numbered in the order the references appear, as
 * GitHub and Obsidian number them. On the cursor's line the markup shows.
 * The parser's part is footnote.ts.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range, SelectionRange } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

type Found = { refs: { id: string; from: number; to: number }[]; defs: { id: string; from: number; to: number }[] };

/** Every reference and definition in the note, in order. The whole note, since numbers depend on it. */
export function footnotesIn(state: EditorState): Found {
	const found: Found = { refs: [], defs: [] };
	const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
	tree.iterate({
		enter: (node) => {
			if (node.name !== "FootnoteRef" && node.name !== "FootnoteDef") return;
			const id = node.node.getChild("FootnoteId");
			if (!id) return false;
			(node.name === "FootnoteRef" ? found.refs : found.defs).push({ id: state.doc.sliceString(id.from, id.to), from: node.from, to: node.to });
			return false;
		},
	});
	return found;
}

/** The number each id is drawn as: first reference first. An id only defined, never referred to, has none. */
export function numbering(found: Found): Map<string, number> {
	const numbers = new Map<string, number>();
	for (const ref of found.refs) if (!numbers.has(ref.id)) numbers.set(ref.id, numbers.size + 1);
	return numbers;
}

class Mark extends WidgetType {
	text: string;
	kind: "ref" | "def";
	target: number | null;
	constructor(text: string, kind: "ref" | "def", target: number | null) {
		super();
		this.text = text;
		this.kind = kind;
		this.target = target;
	}
	eq(other: Mark) {
		return this.text === other.text && this.kind === other.kind && this.target === other.target;
	}
	toDOM() {
		const el = document.createElement("sup");
		el.className = `cm-footnote cm-footnote-${this.kind}`;
		el.textContent = this.text;
		if (this.target !== null) el.dataset.target = String(this.target);
		el.title = this.kind === "ref" ? "Go to the note" : "Back to the text";
		return el;
	}
	ignoreEvent() {
		return false;
	}
}

const touches = (ranges: readonly SelectionRange[], from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);

function marks(view: EditorView): DecorationSet {
	const { state } = view;
	const found = footnotesIn(state);
	const numbers = numbering(found);
	const firstRef = new Map<string, number>();
	for (const ref of found.refs) if (!firstRef.has(ref.id)) firstRef.set(ref.id, ref.from);
	const def = new Map<string, number>();
	for (const d of found.defs) if (!def.has(d.id)) def.set(d.id, d.from);
	const out: Range<Decoration>[] = [];
	const ranges = state.selection.ranges;
	for (const ref of found.refs) {
		if (touches(ranges, ref.from, ref.to)) continue;
		out.push(Decoration.replace({ widget: new Mark(String(numbers.get(ref.id)), "ref", def.get(ref.id) ?? null) }).range(ref.from, ref.to));
	}
	for (const d of found.defs) {
		if (touches(ranges, state.doc.lineAt(d.from).from, state.doc.lineAt(d.to).to)) continue;
		const n = numbers.get(d.id);
		out.push(Decoration.replace({ widget: new Mark(n === undefined ? d.id : String(n), "def", firstRef.get(d.id) ?? null) }).range(d.from, d.to));
	}
	return Decoration.set(out, true);
}

export const footnotesExtension: Extension = [
	ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = marks(view);
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = marks(u.view);
			}
		},
		{ decorations: (p) => p.decorations },
	),
	EditorView.domEventHandlers({
		mousedown(event, view) {
			const el = (event.target as HTMLElement).closest?.(".cm-footnote") as HTMLElement | null;
			if (!el?.dataset.target) return false;
			const pos = Number(el.dataset.target);
			view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
			view.focus();
			return true;
		},
	}),
];
