/**
 * Where the folder's branch stands, as git knows it: which branch, what it
 * was started from, what is changed and not committed, and how many commits
 * it is ahead of and behind the base. Read for the foot of the window
 * (web/src/branchStanding.ts), where it is put beside what the pull request
 * says — which the shell asks GitHub for, since gh is the shell's.
 *
 * From what was last fetched, and no fetch here: it is asked at every turn's
 * end and every focus, and a network call each time is not what a strip at
 * the foot of the window is worth. The base is the remote's default branch,
 * as a workspace is made from it (electron/git.js startOf), or nothing with
 * no remote — then ahead and behind are nothing too.
 *
 * Nothing of Octave's in it: what is not committed leaves out `.pi/` the
 * way removing a workspace counts it (git.js changesIn), since the app
 * writes that folder into every workspace it opens.
 */
import { execFile } from "node:child_process";

import type { GitStanding } from "./protocol.ts";

function git(cwd: string, args: string[]): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: 10_000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
	});
}

/** The remote's default branch as `origin/main`, or null: no remote, or one whose HEAD git does not know. */
export async function baseOf(cwd: string): Promise<string | null> {
	const head = await git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	if (head) return head;
	for (const name of ["origin/main", "origin/master"]) if ((await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/${name}`])) !== null) return name;
	return null;
}

export async function standingIn(cwd: string): Promise<GitStanding | null> {
	const branch = await git(cwd, ["branch", "--show-current"]);
	if (!branch) return null;
	const status = (await git(cwd, ["status", "--porcelain", "--untracked-files=all"])) ?? "";
	const changes = status.split("\n").filter((line) => line && !/^.. "?\.pi\//.test(line)).length;
	const base = await baseOf(cwd);
	if (!base) return { branch, base: null, changes, ahead: null, behind: null };
	const counts = await git(cwd, ["rev-list", "--left-right", "--count", `${base}...HEAD`]);
	const [behind, ahead] = (counts ?? "0\t0").split(/\s+/).map((n) => Number(n) || 0);
	return { branch, base: base.replace(/^origin\//, ""), changes, ahead: ahead ?? 0, behind: behind ?? 0 };
}

/**
 * What the agent is told of the base, after pi's system prompt: which branch
 * this one was started from, and so what a diff, a rebase or a pull request
 * is against — Conductor tells its agents the same. Nothing where there is
 * no base: a folder with no remote has nothing to be against.
 */
export const baseLine = (base: string | null): string | null =>
	base ? `This branch was started from ${base}, the repository's target branch: a diff, a rebase or a pull request is against it, not against whatever branch happens to be checked out elsewhere.` : null;
