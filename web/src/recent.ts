/**
 * The notes opened most recently, newest first, kept in this browser.
 *
 * What the quick-open list shows before anything is typed: the note you were
 * just in is usually the one you want back. In the browser rather than on
 * the server because it is about this window's habit, not the vault — and
 * the list is short enough to lose without loss.
 */
const KEY = "recent-notes";
const KEEP = 20;

/** `path` moved to the front of `list`, the list cut to what is kept. */
export function bump(list: string[], path: string, keep = KEEP): string[] {
	return [path, ...list.filter((p) => p !== path)].slice(0, keep);
}

/** A rename or a delete: the old path is no longer a note to reopen. */
export function forget(list: string[], path: string, replacement?: string): string[] {
	const rest = list.filter((p) => p !== path);
	if (!replacement) return rest;
	const at = list.indexOf(path);
	return at === -1 ? rest : [...rest.slice(0, at), replacement, ...rest.slice(at)].filter((p, i, a) => a.indexOf(p) === i);
}

export function readRecent(): string[] {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
	} catch {
		return [];
	}
}

export function writeRecent(list: string[]): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(list));
	} catch {
		// A window with storage blocked forgets, which is all that is lost.
	}
}
