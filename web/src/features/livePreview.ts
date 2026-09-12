/**
 * Markup hidden where the cursor is not — Obsidian's Live Preview, the
 * inline half of it.
 *
 * One rule: a heading, an emphasis, a link keeps its markup while any
 * selection range touches it, and hides it otherwise. `hidden` is that rule
 * as a pure function of the state and the ranges to look at, so it can be
 * pinned in node without a browser; the view plugin below only calls it
 * over the visible lines and again when the doc, the viewport or the
 * selection moves. Nothing here spans a line break, which is what lets it
 * be a plugin rather than a state field (see EditorView.decorations).
 *
 * The layer sits in a compartment so Mod-e takes it out and puts it back —
 * source mode and live preview, as Obsidian has them.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Compartment, type EditorState, type Extension, RangeSetBuilder, type SelectionRange } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
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
};

const touches = (ranges: readonly SelectionRange[], from: number, to: number) =>
	ranges.some((r) => r.from <= to && r.to >= from);

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

const mode = new Compartment();
const off: Extension = [];

/** Whether the layer is on in this state; source mode when not. */
export const isLivePreview = (state: EditorState) => mode.get(state) !== off;

export const toggleLivePreview = (view: EditorView) => {
	view.dispatch({ effects: mode.reconfigure(isLivePreview(view.state) ? off : plugin) });
	return true;
};

export const livePreview: Extension = [
	mode.of(plugin),
	keymap.of([{ key: "Mod-e", run: toggleLivePreview }]),
];
