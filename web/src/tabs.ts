/**
 * The notes open in the middle column, left to right, kept in this browser.
 *
 * One of them is in front — that one is the address, as before — and the
 * rest wait in the row above it. The row is a fact about this window, like
 * the recent list, so it lives beside it in the browser and not on the
 * server; a rename or a delete reaches it by way of the same `forget`.
 */
const KEY = "open-tabs";

/** `path` added at the end, unless it is already in the row. */
export function add(tabs: string[], path: string): string[] {
	return tabs.includes(path) ? tabs : [...tabs, path];
}

/**
 * The row without `path`, and what is in front afterwards: the same note if
 * a different one was closed, else the neighbour to the right, else to the
 * left, else nothing. The rightward preference is Obsidian's and Chrome's.
 */
export function close(tabs: string[], path: string, active: string | null): { tabs: string[]; active: string | null } {
	const at = tabs.indexOf(path);
	if (at === -1) return { tabs, active };
	const rest = tabs.filter((p) => p !== path);
	if (active !== path) return { tabs: rest, active };
	return { tabs: rest, active: rest[at] ?? rest[at - 1] ?? null };
}

/** The tab at `from` moved to `to`, the others closing up; the row as is if nothing moves. */
export function move(tabs: string[], from: number, to: number): string[] {
	if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) return tabs;
	const next = tabs.slice();
	const [tab] = next.splice(from, 1);
	next.splice(to, 0, tab);
	return next;
}

/** Every tab but `path`, in order: what "close others" closes. */
export function others(tabs: string[], path: string): string[] {
	return tabs.filter((p) => p !== path);
}

/** The tabs after `path`, in order: what "close to the right" closes. None if `path` is not in the row. */
export function toTheRight(tabs: string[], path: string): string[] {
	const at = tabs.indexOf(path);
	return at === -1 ? [] : tabs.slice(at + 1);
}

/** A tab that was closed, and where it was: what ⌘⇧T puts back. */
export type Closed = { path: string; at: number };

/** `closed` back in the row where it was, or as far right as the row now goes; the row as is if it is open already. */
export function reopen(tabs: string[], closed: Closed): string[] {
	if (tabs.includes(closed.path)) return tabs;
	const at = Math.min(closed.at, tabs.length);
	return [...tabs.slice(0, at), closed.path, ...tabs.slice(at)];
}

/** The tab `step` places along from `active`, round the ends; the first if nothing is active. Null with nothing to go to. */
export function neighbour(tabs: string[], active: string | null, step: 1 | -1): string | null {
	if (tabs.length === 0) return null;
	const at = active ? tabs.indexOf(active) : -1;
	if (at === -1) return tabs[0];
	return tabs[(at + step + tabs.length) % tabs.length];
}

export function readTabs(): string[] {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
	} catch {
		return [];
	}
}

export function writeTabs(tabs: string[]): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(tabs));
	} catch {
		// A window with storage blocked opens with one tab next time, which is all that is lost.
	}
}
