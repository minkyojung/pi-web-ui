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
 * @typedef {{ path: string, branch: string, name: string, state?: "archiving" | "archived", commit?: string, at?: string }} Worktree
 * @typedef {{ path: string, worktrees: Worktree[], retired: string[], hidden?: true }} Project
 *
 * A workspace with no `state` is one you can open: its folder is there. An
 * archived one has given its folder back and kept everything else — its
 * branch, the commit it stood on, and the conversation pi keeps by the
 * folder's path — so it is a row that can be brought back rather than a row
 * that is gone. `archiving` is the moment in between, written before the
 * folder is taken away: a shell that dies in that moment leaves a row that
 * says what was being done, and the next start finishes it.
 *
 * `retired` is the names of the workspaces the repository removed before
 * archiving was how it was done. pi keeps a folder's conversations by its
 * path, and a branch is renamed once the work has a subject — so a name
 * whose folder and branch are both gone would be picked again, and the new
 * workspace would open on the old one's conversations. A name once used is
 * not used again; archived workspaces keep their own names on the list.
 */

const isPath = (value) => typeof value === "string" && value.length > 0;

/** A worktree as the settings hold it, or null for anything that is not one. */
function worktreeFrom(value) {
	if (!value || !isPath(value.path) || !isPath(value.branch) || !isPath(value.name)) return null;
	const worktree = { path: value.path, branch: value.branch, name: value.name };
	if (value.state !== "archived" && value.state !== "archiving") return worktree;
	return {
		...worktree,
		state: value.state,
		...(isPath(value.commit) ? { commit: value.commit } : {}),
		...(isPath(value.at) ? { at: value.at } : {}),
	};
}

/**
 * The projects the settings hold, with the ones whose folder is no longer a
 * checkout left out — a clone that was deleted, a worktree removed outside the
 * app. A list that offers a folder which is not there is worse than a short
 * list.
 *
 * A repository the person took off the list is `hidden` and still here:
 * everything written back goes through this, so a project dropped here would
 * be forgotten by the next write, and taking one off the list is meant to be
 * undone by adding it again — Conductor's `repos.hidden`. Who draws a list
 * leaves them out (main.js `workspaces`).
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
			// An archived workspace has no folder — that is what archiving it was
			// — so it is on the list by its row rather than by a folder being there.
			.filter((worktree) => worktree && !seen.has(worktree.path) && (worktree.state ? true : exists(worktree.path)));
		for (const worktree of worktrees) seen.add(worktree.path);
		const retired = Array.isArray(entry.retired) ? [...new Set(entry.retired.filter(isPath))] : [];
		projects.push({ path: entry.path, worktrees, retired, ...(entry.hidden === true ? { hidden: true } : {}) });
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
 * The projects with the repository at `root` taken off the list, or put back
 * on it. Nothing of it goes: its workspaces, the names it has used and the
 * order it sits in are all still here, so adding the repository again is the
 * whole of the way back. A path that is no project changes nothing.
 */
export function hiddenRepository(projects, root, hidden) {
	return projects.map((project) => {
		if (project.path !== root) return project;
		const { hidden: _was, ...rest } = project;
		return hidden ? { ...rest, hidden: true } : rest;
	});
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

/**
 * The projects with the workspace at `path` in the state given, and with
 * `commit` and `at` on it when it is archived — Conductor's Archive, which
 * keeps the row and gives back the folder. `null` is the way back: the row is
 * a workspace you can open again, and what it remembered of the archive goes.
 * A path that is no workspace changes nothing.
 */
export function workspaceState(projects, path, state, { commit = null, at = null } = {}) {
	return projects.map((project) => {
		const had = project.worktrees.find((w) => w.path === path);
		if (!had) return project;
		const now = { path: had.path, branch: had.branch, name: had.name };
		const next = state === null ? now : { ...now, state, ...(commit ? { commit } : had.commit ? { commit: had.commit } : {}), ...(at ? { at } : had.at ? { at: had.at } : {}) };
		return { ...project, worktrees: project.worktrees.map((w) => (w === had ? next : w)) };
	});
}

/**
 * The workspace to open on starting: the one in front last time, if it is
 * still on the list and not archived — the person opened it, and it is put
 * back. Else none,
 * and the app starts on its first screen: a workspace is opened by the person
 * and not for them, so another is not opened in its place. A folder in front
 * that is not a listed workspace — a repository's own clone, a folder of
 * notes from before — is not opened: work happens in a workspace.
 */
export function firstWorkspace(projects, workdir) {
	return projects.filter((project) => !project.hidden).flatMap((project) => project.worktrees).find((worktree) => worktree.path === workdir && !worktree.state)?.path ?? null;
}

/**
 * What a workspace's row says of its branch: a pull request's state when it
 * has one — open, merged, closed without merging — else only whether the
 * remote has it. Merged is never read off git alone: a branch with no commit
 * of its own, which every new workspace is, is indistinguishable there from
 * one whose commits were all taken in (git.js onRemote).
 *
 * @returns {{ state: "local" | "pushed" | "open" | "merged" | "closed", number?: number, title?: string, url?: string | null, draft?: boolean, review?: string, checks?: { total: number, pending: number, failed: number }, merge?: string, added?: number | null, deleted?: number | null, commits?: number | null, method?: string }}
 */
export function statusOf({ onRemote, pr }) {
	if (pr) {
		const state = { OPEN: "open", MERGED: "merged", CLOSED: "closed" }[pr.state];
		if (state)
			return {
				state,
				number: pr.number,
				title: pr.title ?? "",
				url: pr.url ?? null,
				draft: pr.draft === true,
				review: pr.review ?? "",
				checks: pr.checks ?? { total: 0, pending: 0, failed: 0 },
				merge: pr.merge ?? "",
				added: pr.added ?? null,
				deleted: pr.deleted ?? null,
				commits: pr.commits ?? null,
				method: pr.method ?? "",
			};
	}
	return { state: onRemote ? "pushed" : "local" };
}

/**
 * What was last learnt about each key, given at once, and learnt again when
 * it is over `staleMs` old — `onFresh` says when a newer answer has landed,
 * for the list to be drawn again. Stale-while-revalidate, as HTTP has it:
 * whoever asks never waits, and what they get is the truth as of the last
 * answer. Nothing learnt yet is null; an `ask` that fails keeps what was
 * known and is not asked again until the next `staleMs`.
 */
export function remembered({ ask, onFresh, now = Date.now, staleMs }) {
	/** key → what is known and when, and the ask under way if one is. */
	const known = new Map();
	return (key) => {
		const had = known.get(key) ?? { at: -Infinity, answer: null, asking: null };
		known.set(key, had);
		if (!had.asking && now() - had.at >= staleMs) {
			// Started now, not on the next tick, and a throw on the way out is a failed ask.
			had.asking = new Promise((resolve) => resolve(ask(key)))
				.catch(() => null)
				.then((answer) => {
					had.at = now();
					had.asking = null;
					if (answer === null) return;
					had.answer = answer;
					onFresh(key);
				});
		}
		return had.answer;
	};
}
