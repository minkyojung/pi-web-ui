/**
 * The vault: the folder pi works in, read and written as notes.
 *
 * The folder is pi's own, so what this lists is exactly what pi can `read` and
 * `edit` — the sidebar and the agent look at the same thing. Read from disk on
 * every ask rather than watched: the ask happens on connect and when a run
 * settles, which is when the answer can have changed.
 *
 * Writing is guarded, not merged. A save says what it was written on top of,
 * and one that lands after pi has changed the file is refused and reported —
 * the two writers are one person and one agent that works in turns, so this
 * is rare, and rare things are better seen than smoothed over.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

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

/**
 * The absolute path of a note, or null for anything that is not one.
 *
 * Inside the folder, and a markdown file: pi may reach every file in the
 * folder with its own tools, but what the editor opens and saves is a note.
 * Resolved and compared, not pattern-matched, so `..` in any encoding is
 * caught the same way.
 */
export function resolveNote(root: string, path: string): string | null {
	if (!path || isAbsolute(path) || !path.endsWith(".md")) return null;
	const full = normalize(join(root, path));
	const rel = relative(root, full);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	if (rel.split(sep).some((part) => part.startsWith("."))) return null;
	return full;
}

export type Note = { path: string; text: string; modified: number };

/** A note's text and the time it was written, or null if there is no such note. */
export function readNote(root: string, path: string): Note | null {
	const full = resolveNote(root, path);
	if (!full) return null;
	try {
		return { path, text: readFileSync(full, "utf8"), modified: statSync(full).mtimeMs };
	} catch {
		return null;
	}
}

export type WriteResult =
	| { ok: true; modified: number }
	/** The file has changed since `base`; the current time is sent so the caller can reload. */
	| { ok: false; reason: "conflict"; modified: number }
	/** The writer had a version, and the file is gone. */
	| { ok: false; reason: "missing" }
	| { ok: false; reason: "invalid" };

/**
 * Write a note on top of the version the writer had.
 *
 * `base` is the mtime the text was read at, or null for a note that did not
 * exist yet. Anything else on disk is a conflict. The write itself goes
 * through a rename, so a crash mid-write leaves the old note rather than half
 * of the new one.
 */
export function writeNote(root: string, path: string, text: string, base: number | null): WriteResult {
	const full = resolveNote(root, path);
	if (!full) return { ok: false, reason: "invalid" };
	let current: number | null = null;
	try {
		current = statSync(full).mtimeMs;
	} catch {
		// No file yet. `base` must say so too.
	}
	if (current !== base) {
		return current === null ? { ok: false, reason: "missing" } : { ok: false, reason: "conflict", modified: current };
	}
	mkdirSync(dirname(full), { recursive: true });
	const tmp = `${full}.${process.pid}.tmp`;
	writeFileSync(tmp, text);
	renameSync(tmp, full);
	return { ok: true, modified: statSync(full).mtimeMs };
}

/**
 * The name of a new note: "Untitled", and a number when there already is one.
 *
 * Not a date and not a guess at a title. The name is the title, which the
 * person gives it in the title field; until then the file says only that it
 * has none. A note that was never given a name keeps saying so, which is
 * more honest than a date that means nothing about it.
 */
export function newNoteName(existing: Iterable<string>): string {
	const taken = new Set(existing);
	if (!taken.has("Untitled.md")) return "Untitled.md";
	for (let n = 2; ; n++) if (!taken.has(`Untitled ${n}.md`)) return `Untitled ${n}.md`;
}

export type RenameResult =
	| { ok: true }
	| { ok: false; reason: "invalid" | "missing" | "exists" };

/**
 * Give a note another path. The file moves; nothing about it is read or
 * rewritten, so its version does not change. The caller moves what sits
 * beside it — its history — and tells the tabs.
 */
export function renameNote(root: string, from: string, to: string): RenameResult {
	const src = resolveNote(root, from);
	const dst = resolveNote(root, to);
	if (!src || !dst) return { ok: false, reason: "invalid" };
	if (src === dst) return { ok: true };
	try {
		statSync(src);
	} catch {
		return { ok: false, reason: "missing" };
	}
	try {
		statSync(dst);
		return { ok: false, reason: "exists" };
	} catch {
		// Free, which is the point.
	}
	mkdirSync(dirname(dst), { recursive: true });
	renameSync(src, dst);
	return { ok: true };
}
