/**
 * Editing a table's pipes without fighting them, the way Obsidian has it:
 * Tab to the next cell and Shift-Tab back (a new row from the last cell),
 * Enter for a row under this one, and the pipes lined up whenever the
 * cursor leaves the table — so what is typed ragged is read square. Only
 * inside a table: elsewhere these keys are what they were.
 *
 * The formatting is a pure function over the table's lines (formatTable),
 * and runs off the cursor, never under it: a table being typed in is left
 * exactly as typed.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate, ViewPlugin } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** The table node around `pos`, if the position is in one. */
function tableAt(state: EditorState, pos: number): SyntaxNode | null {
	for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (n.name === "Table") return n;
	// At the very end of a table, the inner resolve lands after it.
	for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (n.name === "Table") return n;
	return null;
}

/** Every cell of the table, in reading order, as [from, to] of its words. */
function cellsOf(table: SyntaxNode): { from: number; to: number; row: number; col: number }[] {
	const out: { from: number; to: number; row: number; col: number }[] = [];
	let row = 0;
	for (let r = table.firstChild; r; r = r.nextSibling) {
		if (r.name !== "TableHeader" && r.name !== "TableRow") continue;
		let col = 0;
		for (let c = r.firstChild; c; c = c.nextSibling) if (c.name === "TableCell") out.push({ from: c.from, to: c.to, row, col: col++ });
		row++;
	}
	return out;
}

/** A row of `count` empty cells, in the table's own indentation. */
const emptyRow = (count: number) => `|${" |".repeat(count)}`;

const columnsOf = (state: EditorState, table: SyntaxNode) => {
	const header = table.getChild("TableHeader");
	return header ? header.getChildren("TableCell").length : Math.max(1, (state.doc.lineAt(table.from).text.match(/\|/g)?.length ?? 2) - 1);
};

/** The cursor to the next cell's words (Shift: the previous); from the last cell, a new row. */
function step(dir: 1 | -1) {
	return (view: EditorView): boolean => {
		const { state } = view;
		const pos = state.selection.main.head;
		const table = tableAt(state, pos);
		if (!table) return false;
		const cells = cellsOf(table);
		// The cell the cursor is in: the last one that starts at or before it —
		// at a cell's end the cursor sits before the pipe, still in that cell.
		let at = -1;
		cells.forEach((c, i) => {
			if (c.from <= pos) at = i;
		});
		const next = at + dir;
		if (next >= 0 && next < cells.length) {
			const cell = cells[next];
			view.dispatch({ selection: { anchor: cell.from, head: cell.to }, scrollIntoView: true });
			return true;
		}
		if (dir === 1) {
			const end = state.doc.lineAt(table.to).to;
			const row = emptyRow(columnsOf(state, table));
			view.dispatch({ changes: { from: end, insert: `\n${row}` }, selection: { anchor: end + 3 }, userEvent: "input" });
			return true;
		}
		return false;
	};
}

/** A row under the cursor's, empty, the cursor in its first cell. */
function rowBelow(view: EditorView): boolean {
	const { state } = view;
	const pos = state.selection.main.head;
	const table = tableAt(state, pos);
	if (!table) return false;
	const line = state.doc.lineAt(pos);
	const row = emptyRow(columnsOf(state, table));
	view.dispatch({ changes: { from: line.to, insert: `\n${row}` }, selection: { anchor: line.to + 3 }, userEvent: "input" });
	return true;
}

/** The width of a cell's words as drawn: wide characters count two. */
const width = (s: string) => [...s].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);

/**
 * The table's lines with the pipes lined up: every cell padded to its
 * column's widest, the delimiter row's dashes to match, its `:` kept where
 * they were. Rows short of cells are filled, long ones kept whole.
 */
export function formatTable(text: string): string {
	const lines = text.split("\n");
	const rows = lines.map((l) => {
		const t = l.trim().replace(/^\|/, "").replace(/\|$/, "");
		return t.split("|").map((c) => c.trim());
	});
	const columns = Math.max(...rows.map((r) => r.length));
	for (const r of rows) while (r.length < columns) r.push("");
	const widths = Array.from({ length: columns }, (_, i) => Math.max(3, ...rows.map((r, ri) => (ri === 1 ? 0 : width(r[i])))));
	return rows
		.map((r, ri) => {
			if (ri === 1) {
				return `| ${r.map((c, i) => {
					const left = c.startsWith(":"), right = c.endsWith(":");
					const dashes = "-".repeat(Math.max(1, widths[i] - (left ? 1 : 0) - (right ? 1 : 0)));
					return `${left ? ":" : ""}${dashes}${right ? ":" : ""}`;
				}).join(" | ")} |`;
			}
			return `| ${r.map((c, i) => c + " ".repeat(widths[i] - width(c))).join(" | ")} |`;
		})
		.join("\n");
}

/** The tables the selection was in a moment ago and is not in now: their lines put square. */
const squareOnLeave = ViewPlugin.fromClass(
	class {
		was: { from: number; to: number }[] = [];
		update(u: ViewUpdate) {
			if (!u.selectionSet && !u.docChanged) return;
			const now = tablesUnder(u.state);
			const left = this.was.filter((t) => !now.some((n) => n.from === t.from));
			this.was = now;
			if (left.length === 0 || u.docChanged) return;
			// After this update, not inside it: a change dispatched from an update is refused.
			const { view } = u;
			queueMicrotask(() => {
				const { state } = view;
				const changes = [];
				for (const t of left) {
					const from = state.doc.lineAt(Math.min(t.from, state.doc.length)).from;
					const table = tableAt(state, from);
					if (!table) continue;
					const first = state.doc.lineAt(table.from).from;
					const last = state.doc.lineAt(table.to).to;
					const text = state.doc.sliceString(first, last);
					const squared = formatTable(text);
					if (squared !== text) changes.push({ from: first, to: last, insert: squared });
				}
				if (changes.length) view.dispatch({ changes, userEvent: "format.table" });
			});
		}
	},
);

function tablesUnder(state: EditorState): { from: number; to: number }[] {
	const out: { from: number; to: number }[] = [];
	for (const r of state.selection.ranges) {
		const t = tableAt(state, r.head);
		if (t && !out.some((o) => o.from === t.from)) out.push({ from: t.from, to: t.to });
	}
	return out;
}

export const tableEdit: Extension = [
	// Ahead of the editor's own Tab and Enter — a list's indent, a paragraph's
	// newline — which come first in the editor's keymap; inside a table these
	// are the table's, and outside one they say no and pass the key on.
	Prec.high(
		keymap.of([
			{ key: "Tab", run: step(1) },
			{ key: "Shift-Tab", run: step(-1) },
			{ key: "Enter", run: rowBelow },
		]),
	),
	squareOnLeave,
];
