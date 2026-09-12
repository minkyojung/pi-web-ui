/**
 * Mod-b and Mod-i: bold and italic on and off, as Obsidian binds them.
 *
 * One rule per range, the way CodeMirror's own commands are written — as a
 * function of the state, over every selection range at once with
 * `changeByRange`, so it works with several cursors and undoes as one step.
 * A chosen stretch of text is wrapped in the mark, and unwrapped when it
 * already sits in one, whether the marks were chosen along with it or not.
 * A bare cursor gets an empty pair to type into, and a second press on that
 * empty pair takes it back out. The selection stays on the same words.
 */
import { type EditorState, EditorSelection, type Extension, Prec, type TransactionSpec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

/** How many of `ch` run from `pos` in direction `dir`, within the doc. */
function run(state: EditorState, pos: number, dir: -1 | 1, ch: string): number {
	let n = 0;
	for (let p = pos; dir < 0 ? p > 0 : p < state.doc.length; p += dir) {
		if (state.sliceDoc(dir < 0 ? p - 1 : p, dir < 0 ? p : p + 1) !== ch) break;
		n++;
	}
	return n;
}

/**
 * The transaction that toggles `mark` around every selection range. Whether
 * the mark is on is read from the run of its character on either side, as
 * CommonMark reads it: `**` is on under a run of two or more, `*` under an
 * odd run — so italic inside bold is `***`, and taking it off leaves `**`.
 */
export function toggleMark(state: EditorState, mark: string): TransactionSpec {
	const n = mark.length;
	const ch = mark[0];
	const on = (left: number, right: number) => (n === 2 ? Math.min(left, right) >= 2 : Math.min(left, right) % 2 === 1);
	return state.changeByRange((range) => {
		let { from, to } = range;
		// Marks chosen along with the words count as outside them.
		const inL = run(state, from, 1, ch);
		const inR = run(state, to, -1, ch);
		if (from < to && inL > 0 && inR > 0 && from + inL <= to - inR) {
			from += inL;
			to -= inR;
		}
		if (on(run(state, from, -1, ch), run(state, to, 1, ch))) {
			return {
				changes: [{ from: from - n, to: from }, { from: to, to: to + n }],
				range: EditorSelection.range(from - n, to - n),
			};
		}
		return {
			changes: [{ from, insert: mark }, { from: to, insert: mark }],
			range: EditorSelection.range(from + n, to + n),
		};
	});
}

const command = (mark: string) => (view: EditorView) => {
	view.dispatch(toggleMark(view.state, mark));
	return true;
};

export const toggleMarks: Extension = Prec.high(
	keymap.of([
		{ key: "Mod-b", run: command("**") },
		{ key: "Mod-i", run: command("*") },
	]),
);
