/**
 * Footnotes without hunting: type `[^` and the note's footnotes are offered
 * by id with what each says, and one more — a new footnote, numbered next,
 * whose note is started at the end of the text with the cursor in it to be
 * written. And the number in the text says, on hover, what its note says,
 * so a footnote is read where it is referred to. Obsidian's core has both.
 */
import { type Completion, type CompletionContext, type CompletionResult, insertCompletionText, pickedCompletion } from "@codemirror/autocomplete";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";

import { footnotesIn } from "./footnotes.ts";
import { inlineDom } from "./inlineDom.ts";

/** What a definition says: the words after `[^id]:` on its line. */
export function definitionOf(state: EditorState, id: string): string | null {
	const def = footnotesIn(state).defs.find((d) => d.id === id);
	if (!def) return null;
	const line = state.doc.lineAt(def.from);
	return state.doc.sliceString(def.to, line.to).trim();
}

/** The smallest number no footnote has yet: 1, or the next. */
export function nextId(ids: Iterable<string>): string {
	const taken = new Set(ids);
	for (let n = 1; ; n++) if (!taken.has(String(n))) return String(n);
}

/** `id]` at the cursor — over a `]` closeBrackets already put there — and, for a new one, its note begun at the end. */
function applyId(id: string, fresh: boolean) {
	return (view: EditorView, completion: Completion, from: number, to: number) => {
		const closed = view.state.doc.sliceString(to, to + 1) === "]";
		const spec = insertCompletionText(view.state, closed ? id : `${id}]`, from, to);
		const head = (spec.selection as EditorSelection).main.head + (closed ? 1 : 0);
		if (!fresh) {
			view.dispatch({ ...spec, selection: EditorSelection.cursor(head), annotations: pickedCompletion.of(completion) });
			return;
		}
		// The note, started under the last one — or at the end — with the
		// cursor in it: what is typed next is what the footnote says.
		const doc = view.state.doc;
		const last = footnotesIn(view.state).defs.at(-1);
		const at = last ? doc.lineAt(last.from).to : doc.length;
		const lead = last ? "\n" : doc.length === 0 || doc.sliceString(doc.length - 1) === "\n" ? "\n" : "\n\n";
		const entry = `${lead}[^${id}]: `;
		const changes = view.state.changes([spec.changes ?? [], { from: at, insert: entry }]);
		view.dispatch({ changes, selection: EditorSelection.cursor(changes.mapPos(at, 1)), annotations: pickedCompletion.of(completion), scrollIntoView: true });
	};
}

/** After an unclosed `[^`: the footnotes there are, then a new one. */
export function source(ctx: CompletionContext): CompletionResult | null {
	const open = ctx.matchBefore(/\[\^([A-Za-z0-9_-]*)$/);
	if (!open) return null;
	const found = footnotesIn(ctx.state);
	const ids = [...new Set([...found.refs, ...found.defs].map((f) => f.id))];
	const options: Completion[] = ids.map((id) => ({ label: id, detail: (definitionOf(ctx.state, id) ?? "").slice(0, 60) || undefined, type: "text", apply: applyId(id, false) }));
	const fresh = nextId(ids);
	options.push({ label: "New footnote", detail: `[^${fresh}]`, type: "text", boost: -1, apply: applyId(fresh, true) });
	return { from: open.from + 2, options, validFor: /^[A-Za-z0-9_-]*$/ };
}

/** The number in the text, hovered: what its note says. */
const noteOnHover = hoverTooltip((view, pos) => {
	let id: string | null = null;
	let from = pos, to = pos;
	syntaxTree(view.state).iterate({
		from: pos,
		to: pos,
		enter: (node) => {
			if (node.name !== "FootnoteRef") return;
			const idNode = node.node.getChild("FootnoteId");
			if (idNode) {
				id = view.state.doc.sliceString(idNode.from, idNode.to);
				from = node.from;
				to = node.to;
			}
			return false;
		},
	});
	if (id === null) return null;
	const says = definitionOf(view.state, id);
	if (says === null) return null;
	return {
		pos: from,
		end: to,
		above: true,
		create: () => {
			const dom = document.createElement("div");
			dom.className = "cm-tooltip-footnote";
			dom.appendChild(inlineDom(says));
			return { dom };
		},
	};
});

export const footnoteCompletion: Extension = [
	markdownLanguage.data.of({ autocomplete: source }),
	noteOnHover,
	EditorView.baseTheme({
		".cm-tooltip.cm-tooltip-hover:has(.cm-tooltip-footnote)": {
			backgroundColor: "var(--popover)",
			color: "var(--popover-foreground)",
			border: "1px solid var(--border)",
			borderRadius: "0.5rem",
			padding: "0.4rem 0.6rem",
			fontFamily: "inherit",
			fontSize: "13px",
			maxWidth: "24rem",
		},
	}),
];
