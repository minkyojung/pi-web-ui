/**
 * The note page has three parts down its one column — the title, the
 * properties, the text — and ↑ and ↓ carry the cursor across them.
 *
 * They are three different things to the browser: an input, a panel of
 * inputs, and a CodeMirror document. Without this, an arrow at the edge of
 * one of them stops there and the way on is the mouse. Obsidian fixed the
 * same thing in 1.7.1 ("keyboard navigation issues between the inline title,
 * properties, and editor").
 *
 * The pattern is ProseMirror's `maybeEscape`, which is how a nested editor
 * hands a key back: the key is taken only when there is nothing left to move
 * to inside — the cursor is on the first line of the text, the first row of
 * the panel — and otherwise it is passed on and does what it always does.
 * Nothing is taken mid-syllable (`isComposing`).
 *
 * The order of the parts lives here and nowhere else, so that no part has to
 * know what is above or below it; each asks for the next one that is on the
 * page. The parts are found by the ids the page already gives them.
 */
import type { EditorState } from "@codemirror/state";
import { type Command, EditorView } from "@codemirror/view";

import { bodyStartIn, blockIn } from "./properties.ts";

export type Part = "title" | "properties" | "text";

/** Down the page, in the order it is read. */
const ORDER: Part[] = ["title", "properties", "text"];

/** The part one step `way` from `from` that is on the page — a part that is not there is passed over — or null at the ends. */
export function nextPart(from: Part, way: 1 | -1, has: (part: Part) => boolean): Part | null {
	for (let i = ORDER.indexOf(from) + way; i >= 0 && i < ORDER.length; i += way) {
		if (has(ORDER[i])) return ORDER[i];
	}
	return null;
}

// ---------------------------------------------------------------------------
// Where the text begins, which is where the editor's own top edge is

/** Where the note's own text starts in this state: under the properties block, or at the top when there is none. */
export function textStart(state: EditorState): number {
	const block = blockIn(state);
	return block ? bodyStartIn(state, block) : 0;
}

/** Whether `at` is the top of the note's own text: nothing of the text above it, so ↑ leaves rather than moves. */
export const atTextTop = (state: EditorState, at: number) => at <= textStart(state);

// ---------------------------------------------------------------------------
// The parts, as the page holds them

const ROWS = "#properties [data-property] input, #properties [data-property] [role=checkbox], #properties-summary";
const ADD = "#add-property";

/**
 * Where the page's arrows put the cursor in each part: the title's box, the
 * panel's rows, the editor's text.
 *
 * A note with no properties still has an "Add property" button, and the
 * page passes over it: coming from the title there is nothing to fill in
 * yet, and coming up from the text the last property is what was meant.
 * The button is a line of the panel — walked through on the way down, and
 * the last step before the text — but it is not somewhere the page lands.
 * Obsidian, whose panel is not there at all until there is a property,
 * reads the same way.
 *
 * Folded, the panel is one line and so one place to be: the line itself is
 * where the cursor stops, and opening it is what makes the rows to stop at.
 */
const boxesIn = (part: Part): HTMLElement[] => {
	if (part === "title") return [...document.querySelectorAll<HTMLElement>("#title")];
	if (part === "properties") return [...document.querySelectorAll<HTMLElement>(ROWS)];
	return [...document.querySelectorAll<HTMLElement>("#editor .cm-content")];
};

/** The panel line by line, which is its rows and then the button that ends them. */
const panelBoxes = () => [...document.querySelectorAll<HTMLElement>(`${ROWS}, ${ADD}`)];

const has = (part: Part) => boxesIn(part).length > 0;

/** Put the cursor in `part`, at the edge the cursor is coming from: the first of its boxes going down, the last going up. */
export function enter(part: Part, way: 1 | -1): boolean {
	const boxes = boxesIn(part);
	const box = way === 1 ? boxes[0] : boxes[boxes.length - 1];
	if (!box) return false;
	if (part === "text") {
		const view = EditorView.findFromDOM(box);
		if (!view) return false;
		view.focus();
		// The top of the text, not where it was left: the cursor is arriving from
		// the line above, and that is the line it should be on.
		view.dispatch({ selection: { anchor: textStart(view.state) }, scrollIntoView: true });
		return true;
	}
	box.focus();
	if (box instanceof HTMLInputElement && box.type === "text") box.setSelectionRange(box.value.length, box.value.length);
	return true;
}

/** Leave `from` for the part below it, or above it. False when there is none, and the key is then the part's own. */
export function step(from: Part, way: 1 | -1): boolean {
	const to = nextPart(from, way, has);
	return to !== null && enter(to, way);
}

/**
 * Within the panel: the box after this one, or the one before. At its ends
 * the panel itself is left — for the title above, the text below.
 */
export function stepInProperties(from: EventTarget | null, way: 1 | -1): boolean {
	const boxes = panelBoxes();
	const at = boxes.indexOf(from as HTMLElement);
	if (at < 0) return false;
	const next = boxes[at + way];
	if (!next) return step("properties", way);
	next.focus();
	if (next instanceof HTMLInputElement && next.type === "text") next.setSelectionRange(next.value.length, next.value.length);
	return true;
}

// ---------------------------------------------------------------------------
// The editor's edge

/**
 * ↑ on the first line of the text leaves the editor for the properties, or
 * the title. Anywhere else it is the editor's own key.
 *
 * Two things have to be true, and the second is why a position alone will
 * not do: the cursor's line is the first of the text, and the cursor is on
 * the first of the rows that line wraps into. Moving up from a later row
 * lands inside the line — past its start — and from the first row it lands
 * at the start or above, where there is no text left to be in.
 */
export const leaveTextUp: Command = (view) => {
	const range = view.state.selection.main;
	if (view.state.selection.ranges.length > 1 || !range.empty) return false;
	const line = view.state.doc.lineAt(range.head);
	return atTextTop(view.state, line.from) && view.moveVertically(range, false).head <= line.from && step("text", -1);
};
