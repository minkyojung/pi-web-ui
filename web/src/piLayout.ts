/**
 * Where pi sits: a column beside the note, or a dock — a row along the bottom
 * of the window and a window over the corner, as Linear places its agent.
 *
 * The two differ in what ⌘\ does. In the column it folds the column away, and
 * the panel is the truth of whether it is folded. In the dock the row is
 * always there and only the window comes and goes, so the truth is a flag,
 * and this file says how the flag moves.
 *
 * The choice outlives the window, as the columns' widths do; the shadcn
 * sidebar keeps its open state the same way.
 */
export type Layout = "column" | "dock";

const KEY = "pi.layout";

/** Anything but the one other word is the column, which is how the app was before there was a choice. */
export const layoutOf = (stored: string | null): Layout => (stored === "dock" ? "dock" : "column");

/** Storage throws in a window opened with cookies blocked; the default is not worth a crash. */
export function readLayout(): Layout {
	try {
		return layoutOf(localStorage.getItem(KEY));
	} catch {
		return "column";
	}
}

export function writeLayout(layout: Layout): void {
	try {
		localStorage.setItem(KEY, layout);
	} catch {
		// Unwritable storage costs the choice its memory, not this window its layout.
	}
}

/**
 * What can happen to the dock's window: the key or its button, a session
 * picked from the row, or pi arriving in the dock from the column.
 */
export type DockEvent = "toggle" | "pick" | "arrive";

/**
 * Whether the window is shown after the event. A pick shows it — the row's
 * tab is the way to open it, as Linear's is — and so does arriving: moving pi
 * somewhere is asking to see it there.
 */
export function shown(open: boolean, event: DockEvent): boolean {
	return event === "toggle" ? !open : true;
}

/**
 * The sessions the dock's row shows: the newest few, and the current one
 * whatever its age. The rest are in the history list, as Linear keeps them.
 * The list arrives newest first, and stays in that order.
 */
export function inRow<S extends { current: boolean }>(sessions: S[], n = 5): S[] {
	const row = sessions.slice(0, n);
	const current = sessions.find((s) => s.current);
	if (current && !row.includes(current)) row.push(current);
	return row;
}
