/**
 * Git, run as the person would run it: the git on their PATH (shellEnv.js),
 * with their configuration and their credentials, and never waiting on a
 * prompt — a fetch that would ask for a password fails instead, since there
 * is no terminal for it to ask in.
 *
 * A workspace is a worktree of a repository on a branch of its own, made the
 * way Conductor makes one: fetched first, so it starts from the latest commit
 * on the remote even when the clone it is made from is behind, and from the
 * remote's default branch, which moves nothing the clone has checked out.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { pickCity } from "./cities.js";

/** Git's answer, trimmed; its own words when it refuses. */
export function git(cwd, args, { timeoutMs = 60_000 } = {}) {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			args,
			{ cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) reject(new Error(String(stderr).trim() || err.message));
				else resolve(String(stdout).trim());
			},
		);
	});
}

/**
 * The repository a folder belongs to, as the folder its clone is in — the
 * same answer for the clone and for any of its worktrees — or null for a
 * folder that is in none, or in a repository with no working tree.
 */
export async function repositoryOf(path) {
	try {
		const common = await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
		if (!common.endsWith("/.git")) return null;
		return dirname(common);
	} catch {
		return null;
	}
}

/** The branch a folder has checked out, or null when it is on none. */
export async function branchOf(path) {
	try {
		return (await git(path, ["branch", "--show-current"])) || null;
	} catch {
		return null;
	}
}

/**
 * Where a new workspace starts: the remote's default branch — what its HEAD
 * points at, else a main or a master it has — or, for a repository with no
 * remote, the branch its clone has checked out.
 */
export async function startOf(root) {
	const remote = await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => null);
	if (remote) return remote;
	for (const name of ["origin/main", "origin/master"]) {
		const found = await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${name}`]).catch(() => null);
		if (found) return name;
	}
	return (await branchOf(root)) ?? "HEAD";
}

/** Whether the repository has a remote called origin. */
export async function hasOrigin(root) {
	return (await git(root, ["remote"]).catch(() => "")).split("\n").includes("origin");
}

/**
 * Bring the remote's branches up to date. Offline, or refused, is not the
 * end of making a workspace — it starts from the last commit fetched — so
 * this says whether it worked rather than throwing.
 */
export async function fetchOrigin(root) {
	if (!(await hasOrigin(root))) return false;
	try {
		await git(root, ["fetch", "origin"], { timeoutMs: 120_000 });
		return true;
	} catch {
		return false;
	}
}

/**
 * A worktree at `path` on a new branch `branch` from `start`. Not tracking
 * the branch it started from: `git push` from a branch that tracks origin/main
 * would push to main.
 */
export async function addWorktree(root, { path, branch, start }) {
	await git(root, ["worktree", "add", "--no-track", "-b", branch, path, start]);
}

/**
 * A new workspace of the repository at `root`, in the folder `into` — a
 * city's name, on the branch `{owner}/{city}`, or `{city}` with no owner to
 * name. A city is not reused while its folder is there or a branch still
 * carries its name, so a workspace never lands on another's leftovers.
 */
export async function makeWorkspace(root, { into, owner }) {
	let folders = [];
	try {
		folders = readdirSync(into);
	} catch {
		// Nothing made here yet.
	}
	const branches = (await git(root, ["branch", "--list", "--format=%(refname:short)"]).catch(() => "")).split("\n").filter(Boolean);
	const name = pickCity([...folders, ...branches.map((branch) => branch.slice(branch.lastIndexOf("/") + 1))]);
	const branch = owner ? `${owner}/${name}` : name;
	const path = join(into, name);
	await fetchOrigin(root);
	const start = await startOf(root);
	mkdirSync(into, { recursive: true });
	await addWorktree(root, { path, branch, start });
	return { path, branch, name };
}
