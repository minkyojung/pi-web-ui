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
 * @typedef {{ path: string, worktrees: Worktree[] }} Project
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
		projects.push({ path: entry.path, worktrees });
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
	const project = had ?? { path: root, worktrees: [] };
	const known = !worktree || project.worktrees.some((w) => w.path === worktree.path);
	const next = known ? project : { ...project, worktrees: [...project.worktrees, worktree] };
	if (had) return next === had ? projects : projects.map((p) => (p === had ? next : p));
	return [...projects, next];
}
