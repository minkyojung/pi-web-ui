import { useEffect, useSyncExternalStore } from "react";

import { SPECS_DIR } from "../../../documentKinds.ts";
import { taskStore } from "../serverState";
import { specsStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { MessageResponse } from "./ai-elements/message";
import { CheckMark } from "./CheckMark";
import { counts, FileBlock, Size } from "./Commit";

/**
 * One task, looked at: what its run said, and what it changed.
 *
 * The page the person decides on. A task's run ends waiting to be looked at
 * (spec.ts endRun), and this is where: the run's last answer first, whole,
 * since it is written for this reading — what the diff cannot say — and
 * under it the files it changed, open, as a commit's page has them: a file
 * is folded by its line where it is not worth the reading. Accepting it
 * (/spec-done) makes the commit, and the page stays the page — the same
 * address, now read off the commit (taskRead.ts) — with the commit named at
 * its head.
 *
 * Of the spec's own folder only notes.md is shown, after the work: what the
 * run left for the tasks after it (spec.ts), which is worth reading when
 * deciding on this one. The rest of that folder is the app's bookkeeping —
 * the box ticked, the approvals — and is not shown; the commit's page has it.
 *
 * The head is one line in the plan's own grammar: the task's line as
 * tasks.md writes it — its number, then its words — and at the right the
 * check mark and the size, the checks' words behind the mark, on hover: the
 * person came to judge the work, and those are reference. Where the task
 * stands, and accepting it, are in the window's header, where what is to be
 * done about the page in front always is (TaskStanding.tsx).
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
	const notes = mine.files.find((file) => file.path === `${SPECS_DIR}${spec}/notes.md`);
	const total = counts(work);
	return (
		<div id="page" data-task={task} data-standing={mine.standing} className="no-scrollbar edge-top min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-5">
				{/* One line, in the plan's own grammar: the line, and at the right how
				    it was checked and how much changed, the app's word on the checks
				    behind the mark, on hover. The standing is the header's (TaskStanding.tsx). */}
				{/* Further from what is under it than those are from each other: the head names the page, and the rest is read. */}
				<header id="taskHead" className="mb-2 flex min-w-0 items-center gap-2">
					<h1 className="min-w-0 flex-1 truncate text-base font-medium">
						{/* As tasks.md numbers it: `1.` for a task, `2.1` for one under a heading. Dimmer than the words, which are what is read. */}
						<span className="tabular-nums text-muted-foreground">{mine.task.includes(".") ? mine.task : `${mine.task}.`}</span> {mine.title}
					</h1>
					<span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
						{(mine.checks !== null || mine.verified.length > 0) && (
							<CheckMark
								task={mine.task}
								checks={mine.checks}
								verified={mine.verified}
								foot={mine.standing === "review" ? "The app runs its own checks when you accept the task." : mine.verified.length > 0 ? "Click to open what it printed" : undefined}
								onOpen={onOpen}
							/>
						)}
						<span>
							{work.length} {work.length === 1 ? "file" : "files"}
						</span>
						<Size {...total} />
					</span>
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
						<FileBlock key={file.path} file={file} onOpen={onOpen} />
					))}
					{work.length === 0 && <p className="text-sm text-subtle-foreground">Nothing outside the spec's own folder was changed.</p>}
					{notes && <FileBlock key={notes.path} file={notes} onOpen={onOpen} />}
					{mine.truncated && <p className="text-xs text-muted-foreground">More files changed than are shown here.</p>}
				</section>
			</div>
		</div>
	);
}
