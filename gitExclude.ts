/**
 * Keeping a path of the app's out of git without touching the repository's
 * own `.gitignore`: git's `info/exclude`, which is read like one but belongs
 * to this clone and is never committed. Worktrees share their repository's
 * (`--git-path` finds it), so one line keeps the path out of every workspace
 * made from it. Conductor keeps `.context/` out the same way.
 *
 * Written once: a line already there — however it got there — is left be.
 * Outside a repository there is nothing to keep out of, and nothing is done.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function excludeFromGit(root: string, pattern: string): void {
	let file: string;
	try {
		file = resolve(root, execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
	} catch {
		return;
	}
	let text = "";
	try {
		text = readFileSync(file, "utf8");
	} catch {
		// Not there yet: a clone made without git's templates has no info/.
	}
	if (text.split(/\r?\n/).some((line) => line.trim() === pattern)) return;
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}${pattern}\n`);
}
