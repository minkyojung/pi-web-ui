/**
 * The repositories the app works in, and the workspaces made from them.
 *
 * A project is a repository, named by the folder its clone is in. Its
 * workspaces are worktrees of it, each on a branch of its own — Conductor's
 * repository and its workspaces, and what the sidebar lists. The clone itself
 * is not one of them: work happens in a workspace, and the clone is what they
 * are made from. Which folder is in front stays `workdir` in the settings.
 *
 * Pure: settings go in and projects come out, and whether a folder is still
 * a checkout is asked of the caller, so every rule here is tested without a
 * disk.
 */

/**
 * @typedef {{ path: string, branch: string, name: string }} Worktree
 * @typedef {{ path: string, worktrees: Worktree[], retired: string[] }} Project
 *
 * `retired` is the names of the workspaces the repository has had and
 * removed. pi keeps a folder's conversations by its path, and a branch is
 * renamed once the work has a subject — so a name whose folder and branch
 * are both gone would be picked again, and the new workspace would open on
 * the old one's conversations. A name once used is not used again.
 */

const isPath = (value) => typeof value === "string" && value.length > 0;

/** A worktree as the settings hold it, or null for anything that is not one. */
function worktreeFrom(value) {
	if (!value || !isPath(value.path) || !isPath(value.branch) || !isPath(value.name)) return null;
	return { path: value.path, branch: value.branch, name: value.name };
}

/**
 * The projects the settings hold, with the ones whose folder is no longer a
 * checkout left out — a clone that was deleted, a worktree removed outside the
 * app. A list that offers a folder which is not there is worse than a short
 * list.
 */
export function projectsOf(settings, exists) {
	const stored = Array.isArray(settings.projects) ? settings.projects : [];
	const seen = new Set();
	const projects = [];
	for (const entry of stored) {
		if (!entry || !isPath(entry.path) || seen.has(entry.path) || !exists(entry.path)) continue;
		seen.add(entry.path);
		const worktrees = (Array.isArray(entry.worktrees) ? entry.worktrees : [])
			.map(worktreeFrom)
			.filter((worktree) => worktree && !seen.has(worktree.path) && exists(worktree.path));
		for (const worktree of worktrees) seen.add(worktree.path);
		const retired = Array.isArray(entry.retired) ? [...new Set(entry.retired.filter(isPath))] : [];
		projects.push({ path: entry.path, worktrees, retired });
	}
	return projects;
}

/**
 * The projects with the repository at `root` in them, and `worktree` among
 * its workspaces when there is one — each added at the end if it is new, and
 * a worktree already there keeping its place. At the end rather than the top,
 * since the list is the person's and keeps the order they made it in.
 */
export function withWorkspace(projects, root, worktree = null) {
	const had = projects.find((project) => project.path === root);
	const project = had ?? { path: root, worktrees: [], retired: [] };
	const known = !worktree || project.worktrees.some((w) => w.path === worktree.path);
	const next = known ? project : { ...project, worktrees: [...project.worktrees, worktree] };
	if (had) return next === had ? projects : projects.map((p) => (p === had ? next : p));
	return [...projects, next];
}

/**
 * The projects in the order `paths` names, which is the person's: the ones it
 * names, in its order, and then the ones it does not, in theirs. A repository
 * added while the list was on screen is not in an order dropped on the list
 * before it arrived — it is not dropped either, and keeps its place at the
 * end, where a new one goes. A path that is no project is nothing.
 */
export function reordered(projects, paths) {
	const named = [];
	for (const path of Array.isArray(paths) ? paths : []) {
		const project = projects.find((p) => p.path === path);
		if (project && !named.includes(project)) named.push(project);
	}
	return [...named, ...projects.filter((project) => !named.includes(project))];
}

/** The projects without the workspace at `path`; its repository stays, with the rest of its workspaces, and the name is retired. */
export function withoutWorkspace(projects, path) {
	return projects.map((project) => {
		const gone = project.worktrees.find((w) => w.path === path);
		if (!gone) return project;
		return { ...project, worktrees: project.worktrees.filter((w) => w !== gone), retired: project.retired.includes(gone.name) ? project.retired : [...project.retired, gone.name] };
	});
}

/**
 * The workspace to open on starting: the one in front last time, if it is
 * still on the list — the person opened it, and it is put back. Else none,
 * and the app starts on its first screen: a workspace is opened by the person
 * and not for them, so another is not opened in its place. A folder in front
 * that is not a listed workspace — a repository's own clone, a folder of
 * notes from before — is not opened: work happens in a workspace.
 */
export function firstWorkspace(projects, workdir) {
	return projects.flatMap((project) => project.worktrees).find((worktree) => worktree.path === workdir)?.path ?? null;
}

/**
 * What a workspace's row says of its branch: a pull request's state when it
 * has one — open, merged, closed without merging — else only whether the
 * remote has it. Merged is never read off git alone: a branch with no commit
 * of its own, which every new workspace is, is indistinguishable there from
 * one whose commits were all taken in (git.js onRemote).
 *
 * @returns {{ state: "local" | "pushed" | "open" | "merged" | "closed", number?: number, url?: string | null, draft?: boolean, review?: string, checks?: { total: number, pending: number, failed: number } }}
 */
export function statusOf({ onRemote, pr }) {
	if (pr) {
		const state = { OPEN: "open", MERGED: "merged", CLOSED: "closed" }[pr.state];
		if (state) return { state, number: pr.number, url: pr.url ?? null, draft: pr.draft === true, review: pr.review ?? "", checks: pr.checks ?? { total: 0, pending: 0, failed: 0 } };
	}
	return { state: onRemote ? "pushed" : "local" };
}
