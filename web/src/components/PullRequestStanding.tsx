import { CheckIcon, CircleIcon, ExternalLinkIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, XIcon } from "lucide-react";

import { cn } from "cn";
import type { Mark, PullGlyph, PullRequestView, Said } from "../branchStanding";
import { Size } from "./Size";
import { Button } from "./ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { Spinner } from "./ui/spinner";

/**
 * GitHub's four marks for a pull request, in the window's own colours rather
 * than GitHub's: open is in review's (it is a review), merged is done's —
 * Primer's own name for the merged colour is `done` — and a draft or a
 * closed one is the strip's grey. The shape says which on its own; the
 * colour only agrees with it.
 */
function Glyph({ glyph, className }: { glyph: PullGlyph; className?: string }) {
	const size = cn("size-3.5 shrink-0", className);
	if (glyph === "open") return <GitPullRequestIcon className={cn(size, "text-status-review")} aria-hidden />;
	if (glyph === "draft") return <GitPullRequestDraftIcon className={cn(size, "text-muted-foreground")} aria-hidden />;
	if (glyph === "merged") return <GitMergeIcon className={cn(size, "text-status-done")} aria-hidden />;
	return <GitPullRequestClosedIcon className={cn(size, "text-muted-foreground")} aria-hidden />;
}

/** A check's mark, GitHub's: a tick, a cross, a running wheel — and a hollow ring for a thing still wanted. */
function MarkOf({ mark }: { mark: Mark }) {
	if (mark === "passed") return <CheckIcon className="size-3.5 shrink-0 text-status-review" aria-hidden />;
	if (mark === "failed") return <XIcon className="size-3.5 shrink-0 text-destructive" aria-hidden />;
	if (mark === "running") return <Spinner className="size-3 shrink-0 text-status-progress" aria-hidden />;
	if (mark === "waiting") return <CircleIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />;
	return null;
}

function Saying({ said }: { said: Said }) {
	return (
		<span className={cn("flex items-center gap-1", said.tone === "destructive" ? "text-destructive" : "text-muted-foreground")} title={said.text ? undefined : said.label} aria-label={said.label}>
			<MarkOf mark={said.mark} />
			{said.text}
		</span>
	);
}

/**
 * The pull request, at the foot of the window: its mark and number — which
 * open it on GitHub — and after them the one thing most in the way of the
 * merge (branchStanding.ts). Pointing at it brings up the rest, as GitHub's
 * merge box lists them: checks, conflicts, review, the base; and how big it
 * is. A check that failed opens the pull request's checks on GitHub, which is
 * where what each one printed is.
 */
export function PullRequestStanding({ view }: { view: PullRequestView }) {
	const said = view.said;
	return (
		<HoverCard openDelay={150} closeDelay={150}>
			<HoverCardTrigger asChild>
				<span id="branch-standing" data-glyph={view.glyph} data-said={said?.text ?? said?.mark ?? undefined} data-tone={said?.tone} className="flex shrink-0 items-center gap-1 pr-1.5">
					<Button asChild variant="ghost" size="sm" className="cursor-default gap-1 px-1.5 text-xs font-normal">
						<a href={view.url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Open pull request #${view.number}`}>
							<Glyph glyph={view.glyph} />
							<span className="text-foreground tabular-nums">#{view.number}</span>
							<ExternalLinkIcon className="size-3 opacity-60" />
						</a>
					</Button>
					{said &&
						(said.mark === "failed" && view.url ? (
							<a href={`${view.url}/checks`} target="_blank" rel="noreferrer" className="cursor-default">
								<Saying said={said} />
							</a>
						) : (
							<Saying said={said} />
						))}
				</span>
			</HoverCardTrigger>
			<HoverCardContent side="top" align="start" className="w-80 p-3">
				<PullRequestCard view={view} />
			</HoverCardContent>
		</HoverCard>
	);
}

/** What the card behind the item says: the pull request's title, then each thing GitHub's merge box would list, then its size. */
export function PullRequestCard({ view }: { view: PullRequestView }) {
	return (
		<div className="flex flex-col gap-2 text-xs">
			<div className="flex min-w-0 items-center gap-1.5">
				<Glyph glyph={view.glyph} />
				<span className="shrink-0 text-muted-foreground tabular-nums">#{view.number}</span>
				<span className="min-w-0 truncate font-medium">{view.title}</span>
			</div>
			{view.lines.length > 0 && (
				<ul data-pull-request-lines className="flex flex-col gap-1">
					{view.lines.map((line) => (
						<li key={line.text} className={cn("flex items-center gap-2", line.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>
							<span className="flex w-3.5 justify-center">
								<MarkOf mark={line.mark} />
							</span>
							{line.text}
						</li>
					))}
				</ul>
			)}
			{view.size && (
				<div className="text-muted-foreground tabular-nums">
					<Size added={view.size.added} deleted={view.size.deleted} />
					{view.size.commits !== null && ` · ${view.size.commits} ${view.size.commits === 1 ? "commit" : "commits"}`}
				</div>
			)}
		</div>
	);
}
