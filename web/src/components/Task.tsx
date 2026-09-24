import { useEffect, useSyncExternalStore } from "react";
import { ChevronRightIcon } from "lucide-react";

import { taskStore } from "../serverState";
import { specsStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { MessageResponse } from "./ai-elements/message";
import { counts, FileBlock, Size } from "./Commit";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

/**
 * One task, looked at: what its run said, and what it changed.
 *
 * The page the person decides on. A task's run ends waiting to be looked at
 * (spec.ts endRun), and this is where: the run's last answer first, whole,
 * since it is written for this reading — what the diff cannot say — and
 * under it the files it changed, folded to their names and sizes. Folded,
 * unlike a commit's page: the deciding is done on the report and the code is
 * opened where the report gives reason to. Accepting it (/spec-done) makes
 * the commit, and the page stays the page — the same address, now read off
 * the commit (taskRead.ts) — with the commit named at its head.
 *
 * What the head says is three things: the task's line, whether it waits or
 * is accepted, and what the run said it checked. Not the session, not the
 * trailers: the person came to judge the work, and those are the app's
 * bookkeeping.
 *
 * Asked again whenever the specs move (a turn ending, an acceptance) — the
 * server says so with `specs`, and the report or the changes may have moved
 * with it. A task never run here says so.
 */
export default function Task({ spec, task, onOpen }: { spec: string; task: string; onOpen: (path: string) => void }) {
	const answer = useSyncExternalStore(taskStore.subscribe, taskStore.get);
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const mine = answer && answer.spec === spec && answer.task === task ? answer : null;
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	// What the tab reads can move without its address moving: after a turn,
	// after an acceptance. The specs message is the server's word that
	// something of the spec's did, so it is the cue to ask again.
	useEffect(() => {
		if (online) send({ type: "open_task", spec, task });
	}, [online, spec, task, specs]);

	if (!mine) return <div id="page" className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Opening…</div>;
	if (mine.type === "task_gone") {
		return (
			<div id="page" data-task={task} className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-subtle-foreground">
				<span>
					Task {task} of {spec} has not been run here.
				</span>
				<span className="text-xs">Run it from the plan, and what it says and changes will be here.</span>
			</div>
		);
	}

	const work = mine.files.filter((file) => !file.spec);
	const kept = mine.files.filter((file) => file.spec);
	const total = counts(work);
	return (
		<div id="page" data-task={task} data-standing={mine.standing} className="no-scrollbar edge-top min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-5">
				<header id="taskHead" className="flex flex-col gap-1.5">
					<div className="flex min-w-0 items-center gap-2">
						<Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px] font-normal tabular-nums">
							Task {mine.task}
						</Badge>
						<h1 className="min-w-0 truncate text-base font-medium">{mine.title}</h1>
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						{mine.standing === "review" ? (
							<span className="shrink-0 text-status-review" title="The run has ended and its changes are in the folder, not committed. Accept the task to commit them.">
								In review
							</span>
						) : (
							<>
								<span className="shrink-0">Accepted</span>
								{mine.commit && (
									<Badge variant="outline" className="h-5 shrink-0 px-1.5 font-mono text-[11px] font-normal" title={mine.commit.hash}>
										{mine.commit.short}
									</Badge>
								)}
							</>
						)}
						<span className="shrink-0">
							· {work.length} {work.length === 1 ? "file" : "files"}
						</span>
						<Size {...total} />
						{/* The run's own word for how it checked its work, and said to be
						    so: the app runs its own checks when the task is accepted. */}
						{mine.checks && (
							<span className="min-w-0 truncate" title="What the agent said it checked. The app did not run this.">
								· agent: {mine.checks}
							</span>
						)}
						{mine.verified.map((check) => (
							<span key={check.name} className={check.exit === 0 ? "shrink-0" : "shrink-0 text-destructive"} title={`The app ran ${check.name}; it ended with exit ${check.exit}.`}>
								· {check.name} {check.exit === 0 ? "passed" : `failed (exit ${check.exit})`}
							</span>
						))}
						{mine.commit && <span className="shrink-0">· {new Date(mine.commit.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>}
					</div>
				</header>
				{/* The report: the agent's, and marked as the agent's, the way its checks are. */}
				<section id="taskReport" aria-label="What the agent said" className="flex flex-col gap-1.5">
					{mine.report ? (
						<div className="text-sm leading-relaxed">
							<MessageResponse>{mine.report}</MessageResponse>
						</div>
					) : (
						<p className="text-sm text-subtle-foreground">The run said nothing beyond its checks.</p>
					)}
				</section>
				<section aria-label="What changed" className="flex flex-col gap-3">
					{work.map((file) => (
						<FileBlock key={file.path} file={file} onOpen={onOpen} folded />
					))}
					{work.length === 0 && <p className="text-sm text-subtle-foreground">Nothing outside the spec's own folder was changed.</p>}
					{mine.truncated && <p className="text-xs text-muted-foreground">More files changed than are shown here.</p>}
					{kept.length > 0 && (
						<Collapsible className="flex flex-col gap-3">
							<CollapsibleTrigger id="specFiles" className="group flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground">
								<ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
								Spec files ({kept.length}) — the plan's own folder, not the task's work
							</CollapsibleTrigger>
							<CollapsibleContent className="flex flex-col gap-3">
								{kept.map((file) => (
									<FileBlock key={file.path} file={file} onOpen={onOpen} folded />
								))}
							</CollapsibleContent>
						</Collapsible>
					)}
				</section>
			</div>
		</div>
	);
}
