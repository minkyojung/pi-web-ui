import { useEffect, useState } from "react";
import { ArrowUpIcon, GitMergeConflictIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, MessageSquareTextIcon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "cn";
import type { PullAction, PullGlyph, PullRequestView } from "../branchStanding";
import { ADDRESS_REVIEW, FIX_CHECKS, PUSH, RESOLVE_CONFLICTS } from "../pullRequestCommands";
import { CommandButton } from "./CommandButton";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * GitHub's four marks for a pull request, in the window's own colours rather
 * than GitHub's: open is in review's (it is a review), merged is done's —
 * Primer's own name for the merged colour is `done` — and a draft or a
 * closed one is the strip's grey. The shape says which on its own; the
 * colour only agrees with it.
 */
function Glyph({ glyph }: { glyph: PullGlyph }) {
	const size = "size-3.5 shrink-0";
	if (glyph === "open") return <GitPullRequestIcon className={cn(size, "text-status-review")} aria-hidden />;
	if (glyph === "draft") return <GitPullRequestDraftIcon className={cn(size, "text-muted-foreground")} aria-hidden />;
	if (glyph === "merged") return <GitMergeIcon className={cn(size, "text-status-done")} aria-hidden />;
	return <GitPullRequestClosedIcon className={cn(size, "text-muted-foreground")} aria-hidden />;
}

/** The agent's four, each the command it sends, its verb and its icon. The verb says what is wrong: Fix checks is checks that failed. */
const AGENT: Record<Exclude<PullAction, "merge">, { name: string; id: string; label: string; icon: React.ReactNode }> = {
	push: { name: PUSH, id: "push-pr", label: "Push", icon: <ArrowUpIcon /> },
	"resolve-conflicts": { name: RESOLVE_CONFLICTS, id: "resolve-conflicts", label: "Resolve conflicts", icon: <GitMergeConflictIcon /> },
	"fix-checks": { name: FIX_CHECKS, id: "fix-checks", label: "Fix checks", icon: <WrenchIcon /> },
	"address-review": { name: ADDRESS_REVIEW, id: "address-review", label: "Address review", icon: <MessageSquareTextIcon /> },
};

/**
 * The pull request, at the foot of the window: its mark and number, one
 * button that opens it on GitHub — and, only when there is something to do, one button
 * that does it (branchStanding.ts pullRequestOf). Nothing else is said
 * here. Why a check failed, what a reviewer asked, where the conflicts are,
 * is on GitHub, a press away, and the agent reads it there when asked to
 * deal with it; the button's verb is all the window needs to say. While
 * checks run, a spinner, since nothing is to be done but wait.
 *
 * Merge is the shell's, given as `onMerge`; a browser tab has none.
 */
export function PullRequestStanding({ view, onMerge }: { view: PullRequestView; onMerge?: () => Promise<{ error?: string } | null> }) {
	const agent = view.action && view.action !== "merge" ? AGENT[view.action] : null;
	return (
		<span id="branch-standing" data-glyph={view.glyph} data-action={view.action ?? undefined} data-running={view.running || undefined} className="flex shrink-0 items-center gap-1 pr-1.5">
			{/* One button, the mark and the number both: shadcn's link as a button
			    (Button asChild round an <a>), with the ghost's hover over the whole
			    of it saying so — an arrow on the end made it look as though only
			    the arrow went anywhere. Where it goes is said on pointing at it. */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button asChild variant="ghost" size="sm" className="cursor-default gap-1 px-1.5 text-xs font-normal">
						<a href={view.url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open pull request #${view.number} on GitHub`}>
							<Glyph glyph={view.glyph} />
							<span className="tabular-nums">#{view.number}</span>
						</a>
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">Open on GitHub</TooltipContent>
			</Tooltip>
			{view.running && <Spinner className="size-3 shrink-0 text-status-progress" aria-label="Checks running" />}
			{agent && (
				<CommandButton name={agent.name} id={agent.id}>
					{agent.icon}
					{agent.label}
				</CommandButton>
			)}
			{view.action === "merge" && onMerge && <Merge method={view.method} base={view.base} onMerge={onMerge} />}
		</span>
	);
}

/** GitHub's own words for each way it merges, as its Merge button says them. */
const WAYS: Record<string, string> = { MERGE: "Create a merge commit", SQUASH: "Squash and merge", REBASE: "Rebase and merge" };

/**
 * Merge, asked twice: a merge is not taken back from here, so the first press
 * turns the button into Confirm merge, as GitHub's does, and the second
 * merges. Confirm goes back to Merge on its own after a few seconds, on
 * Escape, and when the focus leaves it. How it merges is the repository's
 * default, said on pointing at it. What GitHub says against it — a check it
 * requires, a conflict come to since — is said in a toast in gh's words;
 * once merged, the item says so when the list does, which is asked at once.
 */
function Merge({ method, base, onMerge }: { method: string; base: string; onMerge: () => Promise<{ error?: string } | null> }) {
	const [stage, setStage] = useState<"idle" | "confirm" | "merging">("idle");
	useEffect(() => {
		if (stage === "idle") return;
		// Confirm lapses; Merging… gives up waiting for the list after a while, and is Merge again.
		const timer = setTimeout(() => setStage("idle"), stage === "confirm" ? 4000 : 20_000);
		return () => clearTimeout(timer);
	}, [stage]);
	return (
		<Button
			id="merge-pr"
			variant="outline"
			size="xs"
			data-stage={stage}
			// Confirm in the text's own colour: the one moment here that asks for a decision.
			className={cn("cursor-default font-normal", stage === "confirm" && "text-foreground")}
			disabled={stage === "merging"}
			title={`${WAYS[method] ?? "Merge"} into ${base}`}
			onBlur={() => setStage((now) => (now === "confirm" ? "idle" : now))}
			onKeyDown={(event) => event.key === "Escape" && setStage((now) => (now === "confirm" ? "idle" : now))}
			onClick={async () => {
				if (stage === "idle") return setStage("confirm");
				setStage("merging");
				const merged = await onMerge();
				if (merged?.error || !merged) {
					toast.error("Not merged", { description: merged?.error ?? "The shell could not be asked." });
					setStage("idle");
				}
			}}
		>
			{stage === "confirm" ? (
				"Confirm merge"
			) : stage === "merging" ? (
				<>
					<Spinner className="size-3" />
					Merging…
				</>
			) : (
				<>
					<GitMergeIcon />
					Merge
				</>
			)}
		</Button>
	);
}
