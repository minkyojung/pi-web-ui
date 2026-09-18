/**
 * The folders the app has been pointed at, and the workspaces made from them.
 *
 * A project is a folder someone opened. Its workspaces are the folder itself
 * and the git worktrees the app made from it — Conductor's repository and its
 * workspaces, and what the sidebar lists. Which one is in front stays
 * `workdir` in the settings, the key and the meaning it had when there was
 * only ever one folder.
 *
 * Pure: settings go in and projects come out, and whether a folder is still
 * there is asked of the caller, so every rule here is tested without a disk.
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
 * The projects the settings hold, with the ones whose folder is gone left
 * out — a project whose folder was deleted, and a worktree removed outside the
 * app. A list that offers a folder which is not there is worse than a short
 * list, which is what the recent list decided before this.
 *
 * Settings from before there were projects have a folder in front and a
 * recent list; those become the projects, in that order, each with no
 * worktrees of its own.
 */
export function projectsOf(settings, exists) {
	const stored = Array.isArray(settings.projects)
		? settings.projects
		: [settings.workdir, ...(Array.isArray(settings.recent) ? settings.recent : [])].map((path) => ({ path, worktrees: [] }));
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
 * The projects after `path` has been opened: as they were if it is one of
 * them or a workspace of one, else with it added at the end. At the end
 * rather than the top, since the list is the person's and keeps the order
 * they made it in.
 */
export function opened(projects, path) {
	const known = projects.some((project) => project.path === path || project.worktrees.some((worktree) => worktree.path === path));
	return known ? projects : [...projects, { path, worktrees: [] }];
}
