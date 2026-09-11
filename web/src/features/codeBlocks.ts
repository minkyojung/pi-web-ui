/**
 * Fenced code drawn in a monospace, whole lines at a time.
 *
 * The highlight style already sets inline and fenced code text to a
 * monospace, but a style on the text leaves the fence markers and the line's
 * indentation in the proportional face, so columns in a block do not line
 * up. A line decoration puts the whole line in one face. Found from the
 * syntax tree over the visible ranges, the way CodeMirror's own examples do,
 * and redone only when the doc or the viewport changes.
 */
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const line = Decoration.line({ class: "cm-code-line" });

function codeLines(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name !== "FencedCode") return;
				const first = view.state.doc.lineAt(node.from).number;
				const last = view.state.doc.lineAt(node.to).number;
				for (let n = first; n <= last; n++) {
					const l = view.state.doc.line(n);
					builder.add(l.from, l.from, line);
				}
				return false; // Nothing inside a fence is another fence.
			},
		});
	}
	return builder.finish();
}

export const codeBlocks = [
	ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = codeLines(view);
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
					this.decorations = codeLines(update.view);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	),
	EditorView.baseTheme({
		".cm-code-line": { fontFamily: "ui-monospace, monospace", fontSize: "0.9em" },
	}),
];
