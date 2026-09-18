/**
 * A table drawn as a table, off the cursor; as written on its lines.
 *
 * GFM's pipes are the one piece of markdown that does not read as what it
 * is: rows of `|` are columns to nobody. Obsidian draws the table and puts
 * the pipes back when the cursor is in it, and so does this. The cells'
 * words are drawn with the inline marks they hold (inlineDom.ts). A click
 * on the drawn table puts the cursor where it was clicked, so the pipes
 * come back to be edited.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, type SelectionRange, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

// With the extension: node runs the tests unbundled.
import { inlineDom } from "./inlineDom.ts";

type Align = "left" | "center" | "right" | null;
export type Table = { header: string[]; align: Align[]; rows: string[][]; from: number };

/** The cells of a row node, as text. */
function cells(row: SyntaxNode, slice: (from: number, to: number) => string): string[] {
	const out: string[] = [];
	for (let c = row.firstChild; c; c = c.nextSibling) if (c.name === "TableCell") out.push(slice(c.from, c.to).trim());
	return out;
}

/** `:--` left, `:-:` centre, `--:` right, `---` nothing said. */
export function alignmentsOf(delimiter: string): Align[] {
	return delimiter
		.trim()
		.replace(/^\||\|$/g, "")
		.split("|")
		.map((cell) => {
			const c = cell.trim();
			const left = c.startsWith(":"), right = c.endsWith(":");
			return left && right ? "center" : right ? "right" : left ? "left" : null;
		});
}

export function tableOf(node: SyntaxNode, slice: (from: number, to: number) => string): Table {
	let header: string[] = [];
	let align: Align[] = [];
	const rows: string[][] = [];
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (c.name === "TableHeader") header = cells(c, slice);
		else if (c.name === "TableDelimiter") align = alignmentsOf(slice(c.from, c.to));
		else if (c.name === "TableRow") rows.push(cells(c, slice));
	}
	return { header, align, rows, from: node.from };
}

class TableWidget extends WidgetType {
	table: Table;
	key: string;
	constructor(table: Table) {
		super();
		this.table = table;
		this.key = JSON.stringify([table.header, table.align, table.rows]);
	}
	eq(other: TableWidget) {
		return this.key === other.key;
	}
	toDOM() {
		const el = document.createElement("table");
		el.className = "cm-table";
		const style = (i: number) => (this.table.align[i] ? `text-align:${this.table.align[i]}` : "");
		const thead = el.createTHead();
		const hr = thead.insertRow();
		this.table.header.forEach((text, i) => {
			const th = document.createElement("th");
			th.setAttribute("style", style(i));
			th.appendChild(inlineDom(text));
			hr.appendChild(th);
		});
		const tbody = el.createTBody();
		for (const row of this.table.rows) {
			const tr = tbody.insertRow();
			this.table.header.forEach((_, i) => {
				const td = tr.insertCell();
				td.setAttribute("style", style(i));
				td.appendChild(inlineDom(row[i] ?? ""));
			});
		}
		return el;
	}
	ignoreEvent() {
		return false;
	}
}

const touches = (ranges: readonly SelectionRange[], from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
const onLines = (state: EditorState, ranges: readonly SelectionRange[], from: number, to: number) =>
	touches(ranges, state.doc.lineAt(from).from, state.doc.lineAt(to).to);

/**
 * Every table in the note, drawn, off the selection's lines. The whole note
 * rather than the viewport, and a state field rather than a view plugin:
 * a decoration that replaces lines whole is a block decoration, and the
 * editor takes those from state only (livePreview.ts has the same shape).
 */
function tables(state: EditorState): DecorationSet {
	const slice = (from: number, to: number) => state.doc.sliceString(from, to);
	const out: Range<Decoration>[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== "Table") return;
			if (onLines(state, state.selection.ranges, node.from, node.to)) return false;
			const first = state.doc.lineAt(node.from).from;
			const last = state.doc.lineAt(node.to).to;
			out.push(Decoration.replace({ widget: new TableWidget(tableOf(node.node, slice)), block: true }).range(first, last));
			return false;
		},
	});
	return Decoration.set(out, true);
}

const field = StateField.define<DecorationSet>({
	create: tables,
	update(value, tr) {
		if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return tables(tr.state);
		return value;
	},
	provide: (f) => EditorView.decorations.from(f),
});

export const tablesExtension: Extension = [
	field,
	// A click on the drawn table: the cursor goes into the cell that was
	// clicked — its row and column counted in the drawn table, then found in
	// the tree — which brings the pipes back with the cursor where the eye is.
	EditorView.domEventHandlers({
		mousedown(event, view) {
			const el = event.target as HTMLElement;
			const table = el.closest?.(".cm-table") as HTMLTableElement | null;
			if (!table) return false;
			const cell = el.closest("td, th") as HTMLTableCellElement | null;
			const tr = cell?.parentElement as HTMLTableRowElement | null;
			const row = tr ? [...table.querySelectorAll("tr")].indexOf(tr) : -1;
			const col = cell ? cell.cellIndex : -1;
			let pos = view.posAtDOM(table);
			if (row >= 0 && col >= 0) {
				syntaxTree(view.state).iterate({
					from: pos,
					to: pos,
					enter: (node) => {
						if (node.name !== "Table") return;
						let r = 0;
						for (let n = node.node.firstChild; n; n = n.nextSibling) {
							if (n.name !== "TableHeader" && n.name !== "TableRow") continue;
							if (r++ !== row) continue;
							const cells = n.getChildren("TableCell");
							const c = cells[Math.min(col, cells.length - 1)];
							if (c) pos = c.to;
						}
						return false;
					},
				});
			}
			view.dispatch({ selection: { anchor: pos } });
			view.focus();
			return true;
		},
	}),
];
