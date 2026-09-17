/**
 * Type `[[` and the notes are offered.
 *
 * A completion source on the markdown language, the way CodeMirror wires
 * completion to a language: it wakes when the cursor is after an unclosed
 * `[[`, offers every note by title (with its folder when it has one), and
 * narrows as letters are typed. Accepting writes the title and, when the
 * closing `]]` is not already there from closeBrackets, that too.
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult, insertCompletionText, pickedCompletion } from "@codemirror/autocomplete";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EditorView as View } from "@codemirror/view";

import { titleOf } from "../noteSync.ts";

/**
 * Write the title in, and close the link. What a string `apply` would
 * do — insertCompletionText at every cursor that has the same text
 * before it, marked as a completion for the history and annotated as
 * the picked one — plus the one thing a string cannot: where closeBrackets
 * has already put the `]]`, the cursor steps over it, and where it has
 * not, the `]]` goes in with the title.
 */
export function applyTitle(view: EditorView, completion: Completion, from: number, to: number): void {
	const title = completion.label;
	const closed = view.state.doc.sliceString(to, to + 2) === "]]";
	const spec = insertCompletionText(view.state, closed ? title : `${title}]]`, from, to);
	const sel = spec.selection as EditorSelection;
	view.dispatch({
		...spec,
		selection: closed ? EditorSelection.create(sel.ranges.map((r) => EditorSelection.cursor(r.head + 2)), sel.mainIndex) : sel,
		annotations: pickedCompletion.of(completion),
	});
}

/** The notes offered after an unclosed `[[`, by title, narrowed as letters are typed. */
export function source(notes: () => string[]): (ctx: CompletionContext) => CompletionResult | null {
	return (ctx) => {
		const open = ctx.matchBefore(/\[\[([^\]\n|]*)$/);
		if (!open) return null;
		const options: Completion[] = notes().map((path) => {
			const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			return { label: titleOf(path), detail: folder || undefined, type: "text", apply: applyTitle };
		});
		return { from: open.from + 2, options, validFor: /^[^\]\n|]*$/ };
	};
}

export function linkCompletion(notes: () => string[]): Extension {
	return [
		markdownLanguage.data.of({ autocomplete: source(notes) }),
		autocompletion({ icons: false }),
		View.baseTheme({
			".cm-tooltip.cm-tooltip-autocomplete": {
				backgroundColor: "var(--popover)",
				color: "var(--popover-foreground)",
				border: "1px solid var(--border)",
				borderRadius: "0.5rem",
				fontFamily: "inherit",
				fontSize: "13px",
			},
			".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "0.25rem 0.6rem" },
			".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
				backgroundColor: "var(--accent)",
				color: "var(--accent-foreground)",
			},
			".cm-completionDetail": { color: "var(--muted-foreground)", fontStyle: "normal", marginLeft: "0.6rem" },
		}),
	];
}
