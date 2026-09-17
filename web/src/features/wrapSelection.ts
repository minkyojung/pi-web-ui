/**
 * A mark typed over chosen words wraps them, rather than replacing them.
 *
 * Done the way closeBrackets does it for `(` and `[`: an input handler that
 * sees the character as it is typed and, when there is a selection, puts
 * the mark on both sides of every selected range and keeps the selection on
 * the words. With no selection nothing is done, so a `*` at the start of a
 * line still opens a list item and `_` inside a word is still a letter —
 * which is why `*` is not in closeBrackets' list, and why this is not a
 * pair that closes as it opens.
 *
 * `*` and `_` wrap with one, as typed: a second press wraps again, and
 * `**words**` is two presses. `=`, `~` and `%` mean nothing alone in a
 * note and wrap with two, so one press makes `==words==`, as in Obsidian.
 */
import { EditorSelection, type EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const MARKS: Record<string, string> = { "*": "*", _: "_", "=": "==", "~": "~~", "%": "%%" };

/** The transaction that wraps every selected range in the mark `typed` stands for, or null if it is no mark or nothing is selected. */
export function wrapped(state: EditorState, typed: string): TransactionSpec | null {
	const mark = MARKS[typed];
	if (!mark || state.selection.ranges.every((r) => r.empty)) return null;
	const n = mark.length;
	return state.changeByRange((range) => {
		if (range.empty) return { range };
		return {
			changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
			range: EditorSelection.range(range.from + n, range.to + n),
		};
	});
}

export const wrapSelection: Extension = EditorView.inputHandler.of((view, from, to, text) => {
	if (view.compositionStarted || view.state.readOnly) return false;
	// Only a keystroke over the selection itself: an input method or a paste landing elsewhere is not one.
	const sel = view.state.selection.main;
	if (from !== sel.from || to !== sel.to) return false;
	const tr = wrapped(view.state, text);
	if (!tr) return false;
	view.dispatch(tr, { userEvent: "input.type" });
	return true;
});
