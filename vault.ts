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
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync } from "node:fs";
import { writeAtomic } from "./atomic.ts";
import { propertiesOf, setProperty, withProperties } from "./properties.ts";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { APP_DIR_NAME, isDocument, isSpec, isSpecRecord } from "./documentKinds.ts";

export type NoteFile = {
	/** Relative to the folder, with forward slashes, so it reads as a name. */
	path: string;
	/** Epoch milliseconds. */
	modified: number;
};

/** Folders nothing worth listing lives in; `.git` and `.pi` are the two that matter. */
const SKIP = new Set(["node_modules", "dist", "dist-server", "release", "build", "out"]);

/**
 * Where the walk gives up, which is a guard against the folder not being a
 * folder of notes at all — someone picks their home directory, or a monorepo.
 *
 * It used to be two thousand, which ordinary vaults pass: people keep ten and
 * twenty thousand notes, and every one past the two thousandth was in the
 * folder and in no list. That number was not about how many notes anyone has;
 * it was there because the list was read again on every save, and the server
 * is one thread. It is not read on every save any more (fileIndex.ts), so the
 * guard can sit where it means what it says.
 *
 * It counts notes found, not folders looked in, so a folder full of things
 * that are not notes is bounded by the walk rather than by this. That shows up
 * as a slow start rather than as a stall, now that starting is one of the
 * three times the folder is read.
 */
export const LIMIT = 50_000;

/**
 * The notes, and beside them the documents — the files pi reads as text
 * though they are not (documents.ts): a PDF kept beside the note about it.
 * One walk for both, since the walk is the cost. Documents are paths only;
 * nothing that lists them orders by when they were written.
 */
export function listFiles(root: string): { notes: NoteFile[]; documents: string[] } {
	const out: NoteFile[] = [];
	const documents: string[] = [];
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
			} else if (entry.isFile() && isDocument(entry.name)) {
				documents.push(relative(root, full).split(sep).join("/"));
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
	return { notes: out.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path)), documents: documents.sort() };
}

export const listNotes = (root: string): NoteFile[] => listFiles(root).notes;

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
	const file = fileAt(root, given);
	// On the disk's spelling, so `a.MD` is this note where the file system says
	// it is, and a name that is only ever going to be `.MD` is not a note.
	return file && file.path.endsWith(".md") ? file : null;
}

/**
 * Where a path lands inside the folder, as the vault names it — from the
 * root, forward slashes, on the disk's spelling — or null when it lands
 * outside. What every door below checks first.
 */
function inFolder(root: string, given: string): { path: string; full: string } | null {
	if (!given) return null;
	const full = asOnDisk(isAbsolute(given) ? given : join(root, given));
	const rel = relative(asOnDisk(root), full);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	return { path: rel.split(sep).join("/"), full };
}

/**
 * Any file a path names inside the folder, as the vault names it — the
 * check noteAt makes before asking whether it is a note. Nothing under a
 * dot-folder: .pi/ is the app's and .obsidian/ is Obsidian's.
 */
export function fileAt(root: string, given: string): { path: string; full: string } | null {
	const file = inFolder(root, given);
	return file && !file.path.split("/").some((part) => part.startsWith(".")) ? file : null;
}

/**
 * The spec a path from the folder names (documentKinds.ts), as the vault
 * names it, or null. Placed as a note is — inside the folder once resolved,
 * on the disk's spelling — and then under `.octave/specs/`, the one
 * dot-folder anything here reads. A door of its own rather than an exception
 * in fileAt: everything that asks for a note still cannot see a spec, and a
 * file is never both, since both ask of where the disk says it is.
 */
export function specAt(root: string, given: string): { path: string; full: string } | null {
	if (isAbsolute(given)) return null;
	const file = inFolder(root, given);
	return file && isSpec(file.path) ? file : null;
}

/**
 * The approvals record a path names, placed as a spec is, or null. Not a
 * document and not a note: nothing opens it and nothing writes it from the
 * window — but what it says is what is waiting for the person, so the
 * watcher has to be able to recognise it.
 */
export function specRecordAt(root: string, given: string): { path: string; full: string } | null {
	if (isAbsolute(given)) return null;
	const file = inFolder(root, given);
	return file && isSpecRecord(file.path) ? file : null;
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
 * Any file of the repository a path names, as the vault names it, or null.
 *
 * Placed as a note is — inside the folder once resolved, on the disk's
 * spelling — and then refused for exactly two names, at any depth: `.git`,
 * which is git's own working parts and not a thing to read as text, and the
 * app's own `.pi/` — but for `.pi/runs/`, where the app leaves what the
 * repository's commands printed (electron/runs.js, scripts.js, spec.ts):
 * those are for the person to read, and a tab is where they are read.
 * Every other dot-folder is part of the repository and opens, which is the
 * whole difference from fileAt: that one refuses them all because the
 * notes' lists must not hold `.obsidian`, and this list is git's
 * (repoFiles.ts), where `.github/workflows` and `.octave/specs` belong.
 *
 * Says nothing about what the file is. Whether a path opens as a note, a
 * spec, a document or as text is the window's question (pages.ts); this one
 * is only whether the folder will give it out at all.
 */
export function codeAt(root: string, given: string): { path: string; full: string } | null {
	if (isAbsolute(given)) return null;
	const file = inFolder(root, given);
	if (!file) return null;
	if (file.path.startsWith(`${RUNS_DIR}/`)) return file;
	return file.path.split("/").some((part) => part === ".git" || part === APP_DIR_NAME) ? null : file;
}

/** Where the app leaves what the repository's commands printed, under its own folder. */
export const RUNS_DIR = `${APP_DIR_NAME}/runs`;

/** How much of a file is read into a tab. Past this it is not a file anyone is reading; see CodeMsg. */
export const CODE_MAX = 1_000_000;

export type CodeRead =
	| { ok: true; path: string; text: string; modified: number; truncated: boolean }
	/** No such file, or one there is nothing to show of. */
	| { ok: false; reason: "missing" | "binary" };

/**
 * A file of the repository as text, to be read and not written.
 *
 * Binary is decided as git decides it — a NUL byte in the first eight
 * thousand, which no text has — rather than by the name, so a file with no
 * extension is read and a `.png` is not mistaken for one that is.
 *
 * A file longer than CODE_MAX comes back cut, and says so. The cut is at a
 * byte, so the last character of a long file can arrive broken; that is the
 * price of not deciding a file's encoding, and it is at the end of something
 * already announced as not all there.
 */
export function readCode(root: string, given: string): CodeRead {
	const found = codeAt(root, given);
	if (!found) return { ok: false, reason: "missing" };
	let bytes: Buffer;
	let modified: number;
	try {
		bytes = readFileSync(found.full);
		modified = statSync(found.full).mtimeMs;
	} catch {
		return { ok: false, reason: "missing" };
	}
	if (bytes.subarray(0, 8000).includes(0)) return { ok: false, reason: "binary" };
	// A file is read from its start; a log the commands printed from its end,
	// where the news is — a run left on for a day is read as `tail` reads it,
	// from the first whole line that fits.
	const truncated = bytes.length > CODE_MAX;
	const kept = !truncated ? bytes : found.path.startsWith(`${RUNS_DIR}/`) ? afterLine(bytes.subarray(bytes.length - CODE_MAX)) : bytes.subarray(0, CODE_MAX);
	return { ok: true, path: found.path, text: kept.toString("utf8"), modified, truncated };
}

/** What follows the first newline, so a tail begins on a whole line; all of it when there is none. */
function afterLine(bytes: Buffer): Buffer {
	const at = bytes.indexOf(0x0a);
	return at === -1 ? bytes : bytes.subarray(at + 1);
}

/**
 * The document a path from the folder names, as the vault names it, or null:
 * fileAt's placing, and of a kind documentKinds.ts lists.
 */
export function documentAt(root: string, given: string): string | null {
	if (isAbsolute(given)) return null;
	const file = fileAt(root, given);
	return file && isDocument(file.path) ? file.path : null;
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
	return found ? readAt(found) : null;
}

/** A spec's text and the time it was written, or null if there is no such spec — readNote's answer, through specAt. */
export function readSpec(root: string, path: string): Note | null {
	const found = specAt(root, path);
	return found ? readAt(found) : null;
}

function readAt(found: { path: string; full: string }): Note | null {
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
	return full ? writeOver(full, text, base) : { ok: false, reason: "invalid" };
}

/**
 * Write a spec on top of the version the writer had: writeNote's promise,
 * through specAt. The agent writes a spec with its own tools, not through
 * here, so this is the person's save — refused if the agent has written
 * since the text was read, as VS Code refuses a save over a newer file.
 */
export function writeSpec(root: string, path: string, text: string, base: number | null): WriteResult {
	const full = specAt(root, path)?.full;
	return full ? writeOver(full, text, base) : { ok: false, reason: "invalid" };
}

function writeOver(full: string, text: string, base: number | null): WriteResult {
	let current: number | null = null;
	try {
		current = statSync(full).mtimeMs;
	} catch {
		// No file yet. `base` must say so too.
	}
	if (current !== base) {
		return current === null ? { ok: false, reason: "missing" } : { ok: false, reason: "conflict", modified: current };
	}
	writeAtomic(full, text);
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

/**
 * The note with when it was made written into it — the one thing the app
 * knows at that moment and nothing else does for long.
 *
 * The file system knows it too, and is the wrong place to keep it: a `git
 * clone`, a folder copied, a vault synced — each gives every note the same
 * birthday, the day it arrived. Written into the note, it survives all of
 * them, which is the whole test a stamp has to pass. Nothing else passes it.
 * A title would be a second answer to what the file's name already gives, an
 * id a second name for what the path already is, and a modified time a line
 * that changes on every save and is already in the history beside the words
 * it belongs to.
 *
 * Local time, to the minute, as a person means it: `2026-01-01T00:05` is what
 * the date-and-time widget reads and writes (propertyTypes.ts), and the note
 * has nowhere to put an offset. Never a Date turned into a string — that is a
 * UTC instant, and either side of midnight it is the wrong day.
 *
 * A note that already says when it was made keeps what it says, and one whose
 * block cannot be read is left as it is: nothing is written over here either.
 */
export function withCreated(text: string, at: Date): string {
	const two = (n: number) => String(n).padStart(2, "0");
	const said = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
	const had = propertiesOf(text);
	if (had.block && had.errors.length === 0 && had.doc.has(CREATED)) return text;
	const made = withProperties(text, (doc) => setProperty(doc, CREATED, said));
	return made.ok ? made.text : text;
}

/** What the property is called. `created` is what a vault of markdown notes calls it. */
const CREATED = "created";

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
