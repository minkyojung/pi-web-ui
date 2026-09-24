/**
 * One commit, to be read: what it says of itself, and each file it changed as
 * it was before and as it is after.
 *
 * What a task changed is a commit once it is accepted (spec.ts makes one),
 * and reading it is the other half of specResults.ts, which lists them; what
 * it changed before that is the folder against HEAD, read the same way
 * (readWorking). Before
 * and after are given whole rather than as git's patch: the window draws the
 * difference itself, with the editor's own merge view, which wants the two
 * texts — and that is what lets the lines nothing happened to be folded away
 * and opened again in place, where a patch has only the lines it chose.
 *
 * What is not given as text says why, so the window can say it rather than
 * draw something false:
 *
 * - **binary** — decided as vault.ts decides it for a file on disk, a NUL in
 *   the first eight thousand bytes, of either side.
 * - **large** — either side past CODE_MAX. A file cut short and compared is
 *   a difference that is not there, so it is not cut: it is not shown.
 *
 * Against the commit's first parent, which for a task's commit is its only
 * one; a commit with no parent is compared with nothing, every file new.
 *
 * What is asked for is checked before git hears it. A commit is named by its
 * hash in hex and nothing else — not a branch, not `HEAD~3`, not anything
 * with a dash in front — since the name arrives from a window.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { APP_DIR_NAME, SPECS_DIR } from "./documentKinds.ts";
import { changedIn as countedIn } from "./specResults.ts";
import { CODE_MAX } from "./vault.ts";

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface CommitFile {
	path: string;
	/** The name it had before, for a file renamed; null otherwise. */
	from: string | null;
	status: FileStatus;
	/** Whether the two texts are here, or why they are not. */
	shown: "text" | "binary" | "large";
	/** The file before the commit and after it; null on the side where there is none, and on both when not shown. */
	before: string | null;
	after: string | null;
	/** Lines added and taken out, as git counts them — the same numbers the list of results has; null for a binary file. */
	added: number | null;
	deleted: number | null;
	/** Under the specs' folder: the box, the documents — in the commit, and not the task's work (specResults.ts). */
	spec: boolean;
}

export interface CommitRead {
	commit: string;
	short: string;
	title: string;
	/** When it was committed, in milliseconds. */
	at: number;
	/** What it says under its subject, the trailers left off — a task's is the run's report (spec.ts); null for a commit with only a subject. */
	body: string | null;
	/** Whose it is, when it is a task's: its trailers (spec.ts). */
	spec: string | null;
	task: string | null;
	checks: string | null;
	files: CommitFile[];
	/** The commit changed more files than are given. */
	truncated: boolean;
}

/** How many files of one commit are given: a task's commit has a handful, and a vendored folder has thousands. */
export const FILES_MAX = 200;

/** A commit's hash, whole or short, and nothing else git would take for a revision. */
export const isCommitName = (given: unknown): given is string => typeof given === "string" && /^[0-9a-f]{7,40}$/.test(given);

const FIELD = "\x1f";

function run(root: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<Buffer | null> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd: root, timeout: 30_000, maxBuffer, encoding: "buffer" }, (err, stdout) => resolve(err ? null : stdout));
	});
}

/** A file as one revision holds it: its text, or why not, or null where that revision has no such file. */
async function blob(root: string, rev: string, path: string): Promise<{ text: string } | "binary" | "large" | null> {
	const size = await run(root, ["cat-file", "-s", `${rev}:${path}`]);
	if (size === null) return null;
	if (Number(size.toString("utf8").trim()) > CODE_MAX) return "large";
	const bytes = await run(root, ["cat-file", "blob", `${rev}:${path}`], CODE_MAX + 1024);
	if (bytes === null) return null;
	if (bytes.subarray(0, 8000).includes(0)) return "binary";
	return { text: bytes.toString("utf8") };
}

/** The commit named, or null: not a commit's name, not in this repository, or no repository here. */
export async function readCommit(root: string, name: string): Promise<CommitRead | null> {
	if (!isCommitName(name)) return null;
	const trailer = (key: string) => `%(trailers:key=${key},valueonly,separator=%x20)`;
	const head = await run(root, ["show", "-s", `--format=${["%H", "%h", "%s", "%ct", "%P", trailer("Spec"), trailer("Task"), trailer("Checks"), "%b", "%(trailers)"].join(FIELD)}`, `${name}^{commit}`, "--"]);
	if (head === null) return null;
	const [commit = "", short = "", title = "", seconds = "", parents = "", spec = "", task = "", checks = "", whole = "", trailers = ""] = head.toString("utf8").replace(/\n+$/, "").split(FIELD);
	if (!isCommitName(commit)) return null;
	const parent = parents.trim().split(/\s+/).filter(Boolean)[0] ?? null;

	const listed = await run(root, parent ? ["diff-tree", "-r", "-M", "-z", "--name-status", parent, commit, "--"] : ["diff-tree", "-r", "-M", "-z", "--name-status", "--root", commit, "--"]);
	if (listed === null) return null;
	const changes = changesIn(listed.toString("utf8")).filter((change) => !change.path.startsWith(`${APP_DIR_NAME}/`));
	// The counts, by git's own reckoning rather than a second one made here:
	// the window says these numbers beside the ones specResults.ts gave it.
	const counted = await run(root, parent ? ["diff-tree", "-r", "-M", "-z", "--numstat", parent, commit, "--"] : ["diff-tree", "-r", "-M", "-z", "--numstat", "--root", commit, "--"]);
	const sizes = new Map((counted ? countedIn(counted.toString("utf8").replace(/^[0-9a-f]{40}\n?\0?/, "")) : []).map((file) => [file.path, file]));

	const files: CommitFile[] = [];
	for (const change of changes.slice(0, FILES_MAX)) {
		const before = change.status === "added" || !parent ? null : await blob(root, parent, change.from ?? change.path);
		const after = change.status === "deleted" ? null : await blob(root, commit, change.path);
		const not = [before, after].find((side) => side === "binary" || side === "large") as "binary" | "large" | undefined;
		files.push({
			path: change.path,
			from: change.from,
			status: change.status,
			shown: not ?? "text",
			before: not || before === null || typeof before === "string" ? null : before.text,
			after: not || after === null || typeof after === "string" ? null : after.text,
			added: sizes.get(change.path)?.added ?? null,
			deleted: sizes.get(change.path)?.deleted ?? null,
			spec: change.path.startsWith(SPECS_DIR),
		});
	}
	const said = checks.trim();
	// The body is what git calls it less the trailers, which are its last
	// paragraph when there are any; git gives both, so the one is cut off the
	// other rather than parsed a second time here.
	const block = trailers.trim();
	const body = (block && whole.trimEnd().endsWith(block) ? whole.trimEnd().slice(0, -block.length) : whole).trim();
	return {
		commit,
		short,
		title,
		at: Number(seconds) * 1000,
		body: body || null,
		spec: spec.trim() || null,
		task: task.trim() || null,
		checks: said && said.toLowerCase() !== "none" ? said : null,
		files,
		truncated: changes.length > FILES_MAX,
	};
}

/**
 * The folder as it stands against HEAD — what a task's run left before it is
 * accepted (spec.ts endRun), read the same way a commit is so the window
 * draws it with the same blocks. Every change git's status lists, the app's
 * own folder left out: the file as HEAD has it and as the disk has it now.
 * Null in no repository. A rename is one only when it was staged as one;
 * an unstaged rename is a file gone and a file new, which is what git says.
 */
export async function readWorking(root: string): Promise<{ files: CommitFile[]; truncated: boolean } | null> {
	const status = await run(root, ["status", "--porcelain", "-z", "--untracked-files=all", "--"]);
	if (status === null) return null;
	const changes = statusIn(status.toString("utf8")).filter((change) => !change.path.startsWith(`${APP_DIR_NAME}/`));
	const counted = await run(root, ["diff", "--numstat", "-z", "-M", "HEAD", "--"]);
	const sizes = new Map((counted ? countedIn(counted.toString("utf8")) : []).map((file) => [file.path, file]));
	const files: CommitFile[] = [];
	for (const change of changes.slice(0, FILES_MAX)) {
		const before = change.status === "added" ? null : await blob(root, "HEAD", change.from ?? change.path);
		const after = change.status === "deleted" ? null : await onDisk(root, change.path);
		const not = [before, after].find((side) => side === "binary" || side === "large") as "binary" | "large" | undefined;
		const text = !not && after !== null && typeof after !== "string" ? after.text : null;
		// A file git has not seen is not in its numstat: every line of it is new.
		const counts = sizes.get(change.path) ?? (change.status === "added" && text !== null ? { added: text.split("\n").length - (text.endsWith("\n") ? 1 : 0), deleted: 0 } : null);
		files.push({
			path: change.path,
			from: change.from,
			status: change.status,
			shown: not ?? "text",
			before: not || before === null || typeof before === "string" ? null : before.text,
			after: text,
			added: not === "binary" ? null : (counts?.added ?? null),
			deleted: not === "binary" ? null : (counts?.deleted ?? null),
			spec: change.path.startsWith(SPECS_DIR),
		});
	}
	return { files, truncated: changes.length > FILES_MAX };
}

/** A file as the disk holds it, judged as blob() judges one of git's; null where there is none. */
async function onDisk(root: string, path: string): Promise<{ text: string } | "binary" | "large" | null> {
	try {
		const bytes = await readFile(join(root, path));
		if (bytes.length > CODE_MAX) return "large";
		if (bytes.subarray(0, 8000).includes(0)) return "binary";
		return { text: bytes.toString("utf8") };
	} catch {
		return null;
	}
}

/** `status --porcelain -z`, read: `XY path\0`, and for a staged rename `R  new\0old\0`. Apart from the asking, to be tested on text. */
export function statusIn(out: string): { status: FileStatus; path: string; from: string | null }[] {
	const parts = out.split("\0");
	const changes: { status: FileStatus; path: string; from: string | null }[] = [];
	for (let at = 0; at < parts.length; ) {
		const entry = parts[at++] ?? "";
		if (entry.length < 4) continue;
		const code = entry.slice(0, 2);
		const path = entry.slice(3);
		if (code[0] === "R" || code[0] === "C") {
			const from = parts[at++] ?? "";
			changes.push({ status: code[0] === "R" ? "renamed" : "added", path, from: code[0] === "R" ? from : null });
			continue;
		}
		if (code === "!!") continue;
		changes.push({ status: code === "??" || code[0] === "A" ? "added" : code.includes("D") ? "deleted" : "modified", path, from: null });
	}
	return changes;
}

/** `--name-status -z`, read: `M\0path\0`, and for a rename `R100\0old\0new\0`. Apart from the asking, to be tested on text. */
export function changesIn(out: string): { status: FileStatus; path: string; from: string | null }[] {
	const parts = out.split("\0");
	// With two trees named, diff-tree's first field is the status; with one
	// commit and --root it is the commit's hash first, on a line of its own.
	if (parts.length > 0 && /^[0-9a-f]{40}\n?$/.test(parts[0] ?? "")) parts.shift();
	const changes: { status: FileStatus; path: string; from: string | null }[] = [];
	for (let at = 0; at < parts.length; ) {
		const code = (parts[at++] ?? "").replace(/^\n+/, "");
		if (!code) continue;
		const letter = code[0];
		if (letter === "R" || letter === "C") {
			const from = parts[at++] ?? "";
			const path = parts[at++] ?? "";
			if (path) changes.push({ status: letter === "R" ? "renamed" : "added", path, from: letter === "R" ? from : null });
			continue;
		}
		const path = parts[at++] ?? "";
		if (!path) continue;
		changes.push({ status: letter === "A" ? "added" : letter === "D" ? "deleted" : "modified", path, from: null });
	}
	return changes;
}
