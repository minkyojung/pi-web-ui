/**
 * The folder's notes as a tree, and which of its folders stand open.
 *
 * The server sends the notes flat — a path and a time each, no folders of
 * their own — so the tree is built here from the paths. A folder exists
 * because a note is in it, which is why an empty one cannot appear.
 *
 * Folders first and then notes, each by name, as VS Code and Obsidian order
 * an explorer: a tree answers "where is it", and a name is the thing you
 * know when asking.
 */
import { createStore } from "./serverState.ts";

export type Node =
	| { kind: "folder"; name: string; path: string; children: Node[] }
	| { kind: "file"; name: string; path: string };

const byName = (a: Node, b: Node): number =>
	a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "folder" ? -1 : 1;

/** The tree of `paths`, folders before notes and each level sorted by name. */
export function treeOf(paths: string[]): Node[] {
	const root: Node[] = [];
	const folders = new Map<string, Node[]>();
	for (const path of paths) {
		const parts = path.split("/");
		let siblings = root;
		for (let i = 0; i < parts.length - 1; i++) {
			const folder = parts.slice(0, i + 1).join("/");
			let children = folders.get(folder);
			if (!children) {
				children = [];
				folders.set(folder, children);
				siblings.push({ kind: "folder", name: parts[i], path: folder, children });
			}
			siblings = children;
		}
		siblings.push({ kind: "file", name: parts[parts.length - 1], path });
	}
	for (const children of [root, ...folders.values()]) children.sort(byName);
	return root;
}

/** The folders a note is in, outermost first: `a/b/c.md` is in `a` and `a/b`. */
export function foldersOf(path: string): string[] {
	const parts = path.split("/");
	return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * `open` with the folders around `path` added, so an opened note is in view.
 * The same set back when nothing needed opening, so nothing redraws.
 */
export function reveal(open: ReadonlySet<string>, path: string): ReadonlySet<string> {
	const missing = foldersOf(path).filter((f) => !open.has(f));
	return missing.length === 0 ? open : new Set([...open, ...missing]);
}

/** `open` with `folder` in it or out of it. */
export function toggle(open: ReadonlySet<string>, folder: string): ReadonlySet<string> {
	const next = new Set(open);
	if (!next.delete(folder)) next.add(folder);
	return next;
}

// ---------------------------------------------------------------------------
// The open folders outlive the window, as the widths of the columns do.

const KEY = "open-folders";

function readOpen(): ReadonlySet<string> {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return new Set(Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : []);
	} catch {
		return new Set();
	}
}

/** The folders standing open. Read by the sidebar; changed through `setOpenFolders`. */
export const openFoldersStore = createStore<ReadonlySet<string>>(readOpen());

export function setOpenFolders(open: ReadonlySet<string>): void {
	if (open === openFoldersStore.get()) return;
	try {
		localStorage.setItem(KEY, JSON.stringify([...open]));
	} catch {
		// A window with storage blocked forgets which folders were open, which is all that is lost.
	}
	openFoldersStore.set(open);
}
