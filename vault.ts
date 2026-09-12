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
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

export type NoteFile = {
	/** Relative to the folder, with forward slashes, so it reads as a name. */
	path: string;
	/** Epoch milliseconds. */
	modified: number;
};

/** Folders nothing worth listing lives in; `.git` and `.pi` are the two that matter. */
const SKIP = new Set(["node_modules", "dist", "dist-server", "release", "build", "out"]);

/** Enough to be more than anyone scrolls, few enough that a monorepo cannot stall the server. */
export const LIMIT = 2000;

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
 * A path as the file system itself spells it.
 *
 * Two strings can name one file. A Mac opens `a.MD` when the file is `a.md`,
 * and opens `회의록.md` whichever way its characters are composed; a symlink
 * is a second name for a third place. Deciding "is this the same note?" by
 * comparing the strings gets all of these wrong, and getting them wrong means
 * the app writes one note's history under two names.
 *
 * So it is not decided here: realpath asks the file system, which is the only
 * thing that knows. This is the same problem git settles with core.ignorecase
 * and core.precomposeunicode, taken at the one place a path becomes a name.
 *
 * A note being made does not exist yet, so the deepest part of the path that
 * does is resolved and the rest kept as asked — which is the spelling it will
 * be created with, and true from then on.
 */
function asOnDisk(full: string): string {
	const tail: string[] = [];
	let at = full;
	for (;;) {
		try {
			return join(realpathSync.native(at), ...tail);
		} catch {
			const up = dirname(at);
			if (up === at) return full; // No part of it is there.
			tail.unshift(basename(at));
			at = up;
		}
	}
}

/**
 * The note a path names, as the vault names it — from the root, forward
 * slashes, spelled as the disk spells it — or null if it names none.
 *
 * Inside the folder, and a markdown file: pi may reach every file in the
 * folder with its own tools, but what the editor opens and saves is a note.
 * Containment is checked after resolving, so `..` in any encoding is caught,
 * and so is a symlink pointing out of the folder, which no amount of reading
 * the string would catch.
 */
export function noteAt(root: string, given: string): { path: string; full: string } | null {
	if (!given) return null;
	const full = asOnDisk(isAbsolute(given) ? given : join(root, given));
	const rel = relative(asOnDisk(root), full);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	if (rel.split(sep).some((part) => part.startsWith("."))) return null;
	// On the disk's spelling, so `a.MD` is this note where the file system says
	// it is, and a name that is only ever going to be `.MD` is not a note.
	if (!rel.endsWith(".md")) return null;
	return { path: rel.split(sep).join("/"), full };
}

/**
 * The absolute path of a note named from the folder, or null for anything
 * that is not one. Notes are named from the folder and nowhere else, so an
 * absolute path is not one of them — see notePath for what pi may send.
 */
export function resolveNote(root: string, path: string): string | null {
	if (isAbsolute(path)) return null;
	return noteAt(root, path)?.full ?? null;
}

/**
 * The note a tool's path argument names, as the vault knows notes.
 *
 * pi's tools take a path as given, relative or absolute and spelled however
 * the model spelled it, and every part of the app that has to decide whether
 * pi is touching a note asks this one question so that they cannot disagree
 * about the answer — or about which note it was.
 */
export function notePath(root: string, given: string): string | null {
	return noteAt(root, given)?.path ?? null;
}

export type Note = { path: string; text: string; modified: number };

/**
 * A note's text and the time it was written, or null if there is no such note.
 * The path comes back as the vault names it, which is not always how it was
 * asked for, and is what everything downstream files it under.
 */
export function readNote(root: string, path: string): Note | null {
	const found = noteAt(root, path);
	if (!found) return null;
	try {
		return { path: found.path, text: readFileSync(found.full, "utf8"), modified: statSync(found.full).mtimeMs };
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

/** Where a deleted note goes, beside its history, until it is restored or forgotten. */
export const TRASH_DIR = ".pi/trash";

export type TrashResult = { ok: true; trashed: string } | { ok: false; reason: "invalid" | "missing" };

/**
 * Put a note in the trash: moved, not removed, so it can come back. Its place
 * in the trash is its path, with a time added when that place is taken — a
 * note deleted twice under one name is two notes.
 */
export function trashNote(root: string, path: string, now = new Date()): TrashResult {
	const src = resolveNote(root, path);
	if (!src) return { ok: false, reason: "invalid" };
	try {
		statSync(src);
	} catch {
		return { ok: false, reason: "missing" };
	}
	let trashed = path;
	if (existsSync(join(root, TRASH_DIR, "notes", trashed))) {
		trashed = path.replace(/\.md$/, ` ${now.toISOString().replace(/[:.]/g, "-")}.md`);
	}
	const dst = join(root, TRASH_DIR, "notes", trashed);
	mkdirSync(dirname(dst), { recursive: true });
	renameSync(src, dst);
	return { ok: true, trashed };
}

export type RestoreResult = { ok: true } | { ok: false; reason: "invalid" | "missing" | "exists" };

/** Bring a note back from the trash to its old path, if that path is free. */
export function restoreNote(root: string, trashed: string, path: string): RestoreResult {
	const dst = resolveNote(root, path);
	if (!dst) return { ok: false, reason: "invalid" };
	const src = join(root, TRASH_DIR, "notes", trashed);
	if (!existsSync(src)) return { ok: false, reason: "missing" };
	if (existsSync(dst)) return { ok: false, reason: "exists" };
	mkdirSync(dirname(dst), { recursive: true });
	renameSync(src, dst);
	return { ok: true };
}
