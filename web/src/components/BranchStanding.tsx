import { useEffect, useSyncExternalStore } from "react";

import { cn } from "cn";
import { ExternalLinkIcon } from "lucide-react";

import { standingOf } from "../branchStanding";
import { standingStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { usePageFolder, useWorkspaceList } from "./Repositories";
import { Button } from "./ui/button";

/**
 * Where this workspace's branch stands, at the left end of the foot of the
 * window — the first thing there, so it is in the same place whatever is in
 * front, and there even when nothing is. One item at a time, as Conductor's
 * line is (`#29 ↗ 1 check pending…`): how far the branch has got, and so
 * what to do next. The pull request's number is a chip that opens it in the
 * browser; a check that failed, or changes asked for, is red — the one red
 * thing in a grey strip, since it is the one thing that wants doing.
 *
 * git's side comes from the server, GitHub's from the shell's list, and
 * branchStanding.ts says which one item they come to. The server is asked
 * again when the window comes back: a push, a merge, a commit in a terminal
 * are all things it does not hear.
 */
export function BranchStanding() {
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
	const standing = standingOf(git, row?.status);
	if (!standing) return null;
	const chip = standing.chip;
	return (
		<span id="branch-standing" data-tone={standing.tone} className="flex shrink-0 items-center gap-1" title={standing.title}>
			{chip && (
				<Button asChild variant="outline" size="xs" className="h-5 gap-1 px-1.5 font-mono text-[11px] font-normal">
					<a href={chip.url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open pull request #${chip.number}`}>
						#{chip.number}
						<ExternalLinkIcon className="size-3 opacity-60" />
					</a>
				</Button>
			)}
			<span className={cn("px-1", standing.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>{standing.text}</span>
		</span>
	);
}
