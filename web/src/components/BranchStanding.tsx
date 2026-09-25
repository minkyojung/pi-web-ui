import { useEffect, useSyncExternalStore } from "react";

import { offersPullRequest, pullRequestOf, workOf } from "../branchStanding";
import { standingStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { CreatePullRequest } from "./CreatePullRequest";
import { loadList, usePageFolder, useWorkspaceList, workspaceShell } from "./Repositories";
import { PullRequestStanding } from "./PullRequestStanding";
import { WorkStanding } from "./WorkStanding";

/**
 * Where this workspace's branch stands, at the right end of the note's half
 * of the foot of the window — the last things there, so they are in the same
 * place whatever is in front, and there even when nothing is. Two items, as
 * branchStanding.ts has it: what is on this machine and not on origin, then
 * the pull request (PullRequestStanding.tsx) — or, before there is one,
 * Create PR. Quiet until there is something to do, and then one button.
 *
 * git's side comes from the server, GitHub's from the shell's list. The
 * server is asked again when the window comes back: a push, a merge, a
 * commit in a terminal are all things it does not hear.
 */
export function BranchStanding({ onOpen }: { onOpen: (path: string) => void }) {
	const git = useSyncExternalStore(standingStore.subscribe, standingStore.get);
	const list = useWorkspaceList();
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	useEffect(() => {
		const ask = () => online && send({ type: "ask_standing" });
		window.addEventListener("focus", ask);
		return () => window.removeEventListener("focus", ask);
	}, [online]);
	const here = usePageFolder();
	const row = list?.projects.flatMap((project) => project.worktrees).find((worktree) => worktree.path === here);
	// While GitHub is still working something out — a check running, or
	// whether the pull request can be merged — the list is asked again every
	// half minute, since nothing else would tell the window it had finished.
	// The shell asks gh at most that often however often it is asked
	// (electron/workspaces.js remembered), so this is one call in thirty seconds.
	const status = row?.status;
	const waiting = status?.state === "open" && ((status.checks?.pending ?? 0) > 0 || status.merge === "UNKNOWN");
	useEffect(() => {
		if (!waiting) return;
		const timer = setInterval(loadList, 30_000);
		return () => clearInterval(timer);
	}, [waiting]);
	const work = workOf(git);
	const pull = pullRequestOf(git, status);
	// Merging is the shell's: gh is there, and a browser tab has neither.
	const shell = workspaceShell;
	return (
		<>
			{work && <WorkStanding work={work} onOpen={onOpen} />}
			{pull ? (
				<PullRequestStanding view={pull} onMerge={shell && here ? () => shell.merge(here, pull.number, pull.method) : undefined} />
			) : (
				offersPullRequest(git, status) && <CreatePullRequest />
			)}
		</>
	);
}
