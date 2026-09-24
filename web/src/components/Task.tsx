import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { SPECS_DIR } from "../../../documentKinds.ts";
import type { TaskMsg } from "../../../protocol.ts";
import { commandsStore, configStore, noticesStore, taskStore } from "../serverState";
import { specsStore } from "../serverState";
import { blocked, why } from "../specApprove.ts";
import { getConnection, subscribe } from "../store";
import { wordMessage } from "../taskList.ts";
import { send } from "../ws";
import { MessageResponse } from "./ai-elements/message";
import { CheckMark } from "./CheckMark";
import { counts, FileBlock, Size } from "./Commit";
import { TaskGlyph } from "./TaskGlyph";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Spinner } from "./ui/spinner";

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
 * The head is one line in the plan's own grammar: the standing at the left,
 * the task's line as tasks.md writes it — its number, then its words — and
 * at the right the check mark and the size. The commit,
 * its time and the checks' words are behind the marks, on hover: the person
 * came to judge the work, and those are reference. The standing is also
 * where it is changed (StandingMenu).
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
				{/* One line, in the plan's own grammar (TaskList.tsx): the standing as
				    the mark at the left, the line, and at the right how it was checked
				    and how much changed. What is reference — the commit, when it was
				    accepted, the app's word on the checks — is behind the marks, on hover. */}
				{/* Further from what is under it than those are from each other: the head names the page, and the rest is read. */}
				<header id="taskHead" className="mb-2 flex min-w-0 items-center gap-2">
					<StandingMenu task={mine} />
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

/**
 * The task's standing, and the one thing to be done from it: in review, a
 * menu that accepts it — the command the plan's menu sends (taskList.ts
 * wordMessage); /spec-done runs the checks, ticks the box and makes the
 * commit (spec.ts markTask). Accepted, the page turns to the commit and this
 * is the standing alone, the commit behind it on hover.
 *
 * Only accepting, and not setting aside or opening again as the plan's menu
 * can: the page reads its standing off the sessions and the commits
 * (taskRead.ts), not off the box, so after either it would go on saying
 * what it said before.
 *
 * "Accepting…" from the press until the command has said how it ended. The
 * checks can take as long as they take, and a check that refuses leaves the
 * task in review — so neither a timer nor the page moving will do; what does
 * is that every way the command ends says something (noticesStore). Pressed
 * again before that, a second acceptance would run beside the first.
 */
function StandingMenu({ task }: { task: TaskMsg }) {
	const notices = useSyncExternalStore(noticesStore.subscribe, noticesStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const commands = useSyncExternalStore(commandsStore.subscribe, commandsStore.get);
	// The task pressed, and how many notices there had been then.
	const [sent, setSent] = useState<{ mark: string; notices: number } | null>(null);
	// What the command said while the socket was down is not coming.
	useEffect(() => {
		if (!online) setSent(null);
	}, [online]);

	// Pulled out by its own padding, so the mark stands on the page's left edge with the report under it, and only the pressed ground reaches past it.
	const face = "-ml-1.5 flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground";
	if (task.standing === "done") {
		return (
			<span id="taskStanding" className={face} title={`Accepted${task.commit ? ` in ${task.commit.short}, ${new Date(task.commit.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}.`}>
				<TaskGlyph standing="done" />
				Done
			</span>
		);
	}

	const mark = `${task.spec}/${task.task}`;
	const stop = blocked({
		online,
		streaming: config?.isStreaming ?? false,
		compacting: config?.isCompacting ?? false,
		hasCommand: commands.some((command) => command.name === "spec-done"),
		sent: sent?.mark === mark && sent.notices === notices,
	});
	const accepting = stop === "sent";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button type="button" id="taskStanding" disabled={accepting} className={`${face} hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground`}>
					{accepting ? <Spinner className="size-3.5 text-status-review" aria-label="accepting" /> : <TaskGlyph standing="review" />}
					{accepting ? "Accepting…" : "In review"}
					<ChevronDownIcon className="size-3 opacity-60" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-72">
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">The run has ended; its changes are in the folder, not committed.</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					id="acceptTask"
					disabled={stop !== null}
					onSelect={() => {
						send(wordMessage("done", task.spec, task.task));
						setSent({ mark, notices });
					}}
				>
					<CheckIcon />
					<span className="flex flex-col">
						Accept
						<span className="text-xs text-muted-foreground">{why(stop) ?? "Run the checks, tick the box and commit"}</span>
					</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
