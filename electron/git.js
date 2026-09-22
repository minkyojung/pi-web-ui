/**
 * Git, run as the person would run it: the git on their PATH (shellEnv.js),
 * with their configuration and their credentials — their gh sign-in among
 * them, handed down since git cannot find it on its own (credentials.js) —
 * and never waiting on a prompt: a fetch that would ask for a password fails
 * instead, since there is no terminal for it to ask in.
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
import { gitEnv } from "./credentials.js";

/** Git's answer, trimmed; its own words when it refuses. */
export async function git(cwd, args, { timeoutMs = 60_000 } = {}) {
	const env = { ...process.env, ...(await gitEnv()) };
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			args,
			{ cwd, env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
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
 * name — started from the remote's default branch, or from its branch
 * `start` when one is asked for (spec-mode.md 6절). A city is not reused while its folder is there, a branch still
 * carries its name, or it is among the `retired` — the names of workspaces
 * removed before (workspaces.js) — so a workspace never lands on another's
 * leftovers, nor on its conversations.
 */
export async function makeWorkspace(root, { into, owner, start: from = null, retired = [] }) {
	let folders = [];
	try {
		folders = readdirSync(into);
	} catch {
		// Nothing made here yet.
	}
	const branches = (await git(root, ["branch", "--list", "--format=%(refname:short)"]).catch(() => "")).split("\n").filter(Boolean);
	const name = pickCity([...folders, ...branches.map((branch) => branch.slice(branch.lastIndexOf("/") + 1)), ...retired]);
	const branch = owner ? `${owner}/${name}` : name;
	const path = join(into, name);
	await fetchOrigin(root);
	// A branch asked for is one the remote has, looked for after the fetch and
	// by its whole name: what is not there is refused, not guessed at.
	if (from !== null && !(await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${from}`]).catch(() => null))) {
		throw new Error(`There is no branch called ${from} on the remote.`);
	}
	const start = from !== null ? `origin/${from}` : await startOf(root);
	mkdirSync(into, { recursive: true });
	await addWorktree(root, { path, branch, start });
	return { path, branch, name };
}

/**
 * How many of the person's changes a workspace holds that no commit has:
 * files changed, added or not yet tracked, as `git status` counts them. The
 * app's own folder is left out — Octave writes `.pi/` into every folder it
 * opens, so counted, no workspace would ever be clean.
 */
export async function changesIn(path) {
	const out = await git(path, ["status", "--porcelain", "--untracked-files=all"]);
	return out.split("\n").filter((line) => line && !/^.. "?\.pi\//.test(line)).length;
}

/**
 * A workspace's folder taken away: the worktree, and git's record of it. The
 * branch stays, with every commit made on it. Forced, since git will not
 * remove a worktree with anything untracked in it and the app's own folder
 * always is — whether the person's changes may go with it is the caller's
 * to have asked (changesIn).
 */
export async function removeWorktree(root, path) {
	await git(root, ["worktree", "remove", "--force", path]);
}

/**
 * The branches a new workspace can be started from — the remote's, fetched
 * first, the latest worked on first, by their names without `origin/` — and
 * which of them it starts from when none is chosen. A repository with no
 * remote has none to choose among: its workspaces start where startOf says.
 */
export async function remoteBranches(root) {
	await fetchOrigin(root);
	const out = await git(root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)", "refs/remotes/origin"]).catch(() => "");
	const branches = out
		.split("\n")
		.filter((ref) => ref.startsWith("refs/remotes/origin/") && ref !== "refs/remotes/origin/HEAD")
		.map((ref) => ref.slice("refs/remotes/origin/".length));
	const start = await startOf(root);
	return { branches, base: start.startsWith("origin/") ? start.slice("origin/".length) : null };
}

/**
 * Whether the remote has a workspace's branch. Read from what was last
 * fetched: the list is asked for often and a fetch each time would be a
 * network call per row.
 *
 * Not whether it is merged: git cannot tell. A branch whose every commit is
 * in the base is what a merged branch looks like — and also what a branch
 * with no commit of its own looks like, which every new workspace is, and so
 * every new workspace read as merged. Merged is a pull request's word
 * (github.js), and a spec's branch always has one.
 */
export async function onRemote(root, branch) {
	return (await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]).catch(() => null)) !== null;
}
