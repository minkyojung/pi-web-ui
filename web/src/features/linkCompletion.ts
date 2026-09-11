/**
 * Type `[[` and the notes are offered.
 *
 * A completion source on the markdown language, the way CodeMirror wires
 * completion to a language: it wakes when the cursor is after an unclosed
 * `[[`, offers every note by title (with its folder when it has one), and
 * narrows as letters are typed. Accepting writes the title and, when the
 * closing `]]` is not already there from closeBrackets, that too.
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EditorView as View } from "@codemirror/view";

import { titleOf } from "../noteSync";

export function linkCompletion(notes: () => string[]): Extension {
	const source = (ctx: CompletionContext): CompletionResult | null => {
		const open = ctx.matchBefore(/\[\[([^\]\n|]*)$/);
		if (!open) return null;
		const closed = ctx.state.doc.sliceString(ctx.pos, ctx.pos + 2) === "]]";
		const options: Completion[] = notes().map((path) => {
			const title = titleOf(path);
			const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			return {
				label: title,
				detail: folder || undefined,
				type: "text",
				apply: (view: EditorView, _c: Completion, from: number, to: number) => {
					const insert = closed ? title : `${title}]]`;
					view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 2 : 0) } });
				},
			};
		});
		return { from: open.from + 2, options, validFor: /^[^\]\n|]*$/ };
	};
	return [
		markdownLanguage.data.of({ autocomplete: source }),
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
