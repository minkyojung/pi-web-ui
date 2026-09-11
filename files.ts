/**
 * The notes in the working folder: every markdown file under it, newest first.
 *
 * The folder is the one pi works in, so what this lists is exactly what pi can
 * `read` and `edit` — the sidebar and the agent look at the same thing. Read
 * from disk on every ask rather than watched: the ask happens on connect and
 * when a run settles, which is when the answer can have changed.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type NoteFile = {
	/** Relative to the folder, with forward slashes, so it reads as a name. */
	path: string;
	/** Epoch milliseconds. */
	modified: number;
};

/** Folders nothing worth listing lives in; `.git` and `.pi` are the two that matter. */
const SKIP = new Set(["node_modules", "dist", "dist-server", "release", "build", "out"]);

/** Enough to be more than anyone scrolls, few enough that a monorepo cannot stall the server. */
const LIMIT = 2000;

export function listNotes(root: string): NoteFile[] {
	const out: NoteFile[] = [];
	const walk = (dir: string) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return; // Unreadable folders are not the sidebar's problem to report.
		}
		for (const entry of entries) {
			if (out.length >= LIMIT) return;
			if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				try {
					out.push({ path: relative(root, full).split(sep).join("/"), modified: statSync(full).mtimeMs });
				} catch {
					// Gone between the listing and the stat. Not a note, then.
				}
			}
		}
	};
	walk(root);
	return out.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
}
