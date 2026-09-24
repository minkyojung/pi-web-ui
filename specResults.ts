/**
 * What each task of a spec came to, read off the repository's history.
 *
 * A task accepted is one commit, and that commit says whose it is: `Spec:`,
 * `Task:`, `Checks:` and `Session:` under its subject, in git's trailers
 * (spec.ts, task-runs.md "결과는 커밋에"). So nothing about a result is kept anywhere
 * else — what a task changed, by how much and how it was checked are asked of
 * git, and are the same in a fresh clone, on another machine, and for a task
 * run from the terminal. This is the asking.
 *
 * One `git log` for all of it: the commits reachable from HEAD that carry a
 * `Task:` trailer, each with its trailers and its per-file line counts
 * (`--numstat`). Reachable from HEAD and not every ref: a task done on
 * another branch has not been done here.
 *
 * What a task changed does not count the spec's own folder. The box checked
 * in tasks.md rides in every task's commit and the three documents in the
 * first, and neither is the task's work — the same line spec.ts draws when
 * it asks whether a run did anything. They are still in the commit, and a
 * reading of the whole commit shows them.
 *
 * Nothing of Octave's in it but where the specs are kept, like specTasks.ts.
 */
import { execFile } from "node:child_process";

import { SPECS_DIR } from "./documentKinds.ts";

/** A file a task's commit changed. */
export interface ChangedFile {
	path: string;
	/** Lines added and taken out; null for a binary file, which git does not count. */
	added: number | null;
	deleted: number | null;
}

/** One task's run, as its commit holds it. */
export interface TaskResult {
	/** The task's number in tasks.md — `2`, or `2.1`. */
	task: string;
	/** The commit, whole, and as people say it. */
	commit: string;
	short: string;
	/** The commit's subject, which is the task's line as it was approved. */
	title: string;
	/** When it was committed, in milliseconds. */
	at: number;
	/** What the run said it checked, in its own words, or null for `none` and for nothing said. */
	checks: string | null;
	/** What the app ran for it — the repository's checks, then the task's `_Done when:` — and how each ended; empty when it ran nothing. */
	verified: { name: string; exit: number }[];
	/** The session the run was, as the commit names it — what tells an accepted run from one waiting (specRuns.ts); null for a commit that does not say. */
	session: string | null;
	/** What it changed outside the spec's folder, and the sums of that. */
	files: ChangedFile[];
	added: number;
	deleted: number;
}

/** How many commits back the asking goes: more tasks than a spec has, and a bound on a history that is long. */
const DEPTH = 2000;

const RECORD = "\x1e";
const FIELD = "\x1f";

/**
 * Every task's result, by spec, oldest first within one — the order the work
 * was done in. Empty for a folder in no repository, or one git cannot be run
 * in: there are no results, said the same way as there being none yet.
 *
 * A task run again — its box cleared and the run repeated — has a result for
 * each run, and they are all here; which one a window shows is its to say.
 */
export function taskResults(root: string): Promise<Map<string, TaskResult[]>> {
	const trailer = (key: string, separator = "%x20") => `%(trailers:key=${key},valueonly,separator=${separator})`;
	const format = [RECORD + "%H", "%h", "%s", "%ct", trailer("Spec"), trailer("Task"), trailer("Checks"), trailer("Verified", "%x1d"), trailer("Session")].join(FIELD) + FIELD;
	return new Promise((resolve) => {
		execFile(
			"git",
			["log", `-n${DEPTH}`, "--grep=^Task: ", "--numstat", "-z", `--format=${format}`, "HEAD", "--"],
			{ cwd: root, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
			(err, stdout) => resolve(err ? new Map() : parseResults(String(stdout))),
		);
	});
}

/**
 * git's answer, read. Apart from the asking so that the reading is tested on
 * text: a record is the header's fields and then, with `-z`, the numstat
 * entries NUL-separated — `added\tdeleted\tpath`, a rename being an entry
 * with an empty path followed by the old and the new name.
 */
export function parseResults(out: string): Map<string, TaskResult[]> {
	const bySpec = new Map<string, TaskResult[]>();
	for (const record of out.split(RECORD).slice(1)) {
		const [commit = "", short = "", title = "", seconds = "", spec = "", task = "", checks = "", verified = "", session = "", rest = ""] = record.split(FIELD);
		// `--grep` matches anywhere in the message; a result is a commit whose
		// trailers say so, both of them.
		if (!spec.trim() || !task.trim()) continue;
		const files = changedIn(rest).filter((file) => !file.path.startsWith(SPECS_DIR));
		const said = checks.trim();
		const result: TaskResult = {
			task: task.trim(),
			commit,
			short,
			title,
			at: Number(seconds) * 1000,
			checks: said && said.toLowerCase() !== "none" ? said : null,
			verified: verifiedOf(verified),
			session: session.trim() || null,
			files,
			added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
			deleted: files.reduce((sum, file) => sum + (file.deleted ?? 0), 0),
		};
		const list = bySpec.get(spec.trim()) ?? [];
		list.push(result);
		bySpec.set(spec.trim(), list);
	}
	// git gives the newest first; the work was done the other way round.
	for (const list of bySpec.values()) list.reverse();
	return bySpec;
}

/** The numstat entries of one commit, as `-z` writes them. */
export function changedIn(rest: string): ChangedFile[] {
	const parts = rest.split("\0");
	const files: ChangedFile[] = [];
	for (let at = 0; at < parts.length; at++) {
		const entry = parts[at]!.replace(/^\n+/, "");
		const found = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(entry);
		if (!found) continue;
		let path = found[3]!;
		// A rename: the path is empty here, and the old and new names follow.
		if (path === "") {
			path = parts[at + 2] ?? "";
			at += 2;
		}
		if (!path) continue;
		files.push({ path, added: found[1] === "-" ? null : Number(found[1]), deleted: found[2] === "-" ? null : Number(found[2]) });
	}
	return files;
}

/** The `Verified:` trailers, `name — exit N` each, read back — one a check, in the order they ran; a value not in that shape is left out. */
export function verifiedOf(trailers: string): { name: string; exit: number }[] {
	return trailers
		.split("\x1d")
		.map((one) => /^(.*\S)\s+—\s+exit\s+(\d+)\s*$/.exec(one.trim()))
		.flatMap((found) => (found ? [{ name: found[1]!, exit: Number(found[2]) }] : []));
}
