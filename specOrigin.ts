/**
 * Which of the specs in the folder this workspace did not start.
 *
 * A spec is a branch is a worktree is a pull request (docs/spec-mode.md), but
 * a spec's documents are committed like everything else, so a workspace made
 * from `main` has on its disk every spec that was ever merged into it. Nothing
 * in the files tells the two apart: the folder a person is working on now and
 * the folder some other branch finished last month are the same three
 * documents. The difference is git's, and it is the difference a pull request
 * already draws — what this branch added over the base it was made from. So
 * the specs the base already had are the ones this window has no business
 * naming, and the rest are the work here.
 *
 * Asked of git, not kept: the answer moves only when the base does — a fetch,
 * a rebase — and it is read afresh beside the task results (server.ts
 * loadResults), which is the other thing here that git alone knows.
 *
 * Synchronous, and the base found the way standing.ts finds it, because the
 * window is told where the specs stand in one breath (SpecsMsg) and a spec
 * that arrived as this workspace's and turned out to be another branch's a
 * moment later would have named itself on the screen first.
 */
import { execFileSync } from "node:child_process";

import { SPECS_DIR } from "./documentKinds.ts";

function git(cwd: string, args: string[]): string | null {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
	} catch {
		return null;
	}
}

/** The remote's default branch as `origin/main`, or null — the same question standing.ts asks, asked without waiting. */
function baseOf(cwd: string): string | null {
	const head = git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	if (head) return head;
	for (const name of ["origin/main", "origin/master"]) if (git(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/${name}`]) !== null) return name;
	return null;
}

/**
 * The names of the specs this branch was made with — the ones already under
 * `.octave/specs/` where it left the base.
 *
 * Empty where git cannot say: a folder that is no repository, one with no
 * remote to have a base, a base this branch shares no history with. Nothing
 * is this workspace's or not on a guess — with no answer every spec is its
 * own, which is what the window did before it asked at all.
 */
export function inheritedSpecs(cwd: string): Set<string> {
	const base = baseOf(cwd);
	const merge = base && git(cwd, ["merge-base", base, "HEAD"]);
	if (!merge) return new Set();
	// -z, so a folder name git would otherwise quote comes through as it is.
	const listed = git(cwd, ["ls-tree", "-d", "-z", "--name-only", `${merge}:${SPECS_DIR}`]);
	return new Set((listed ?? "").split("\0").filter(Boolean));
}
