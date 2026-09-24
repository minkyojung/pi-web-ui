import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { commandsStore, configStore, noticesStore, taskStore } from "../serverState";
import { blocked, why } from "../specApprove.ts";
import { getConnection, subscribe } from "../store";
import { wordMessage } from "../taskList.ts";
import { send } from "../ws";
import { TaskGlyph } from "./TaskGlyph";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Spinner } from "./ui/spinner";

/**
 * In the header of a task's page (NoteHeader actions): where the task stands,
 * and the one thing to be done from it — the header's end being where what is
 * to be done about the page in front is, as Approve is a document's.
 *
 * In review it is a menu that accepts it: the command the plan's menu sends
 * (taskList.ts wordMessage); /spec-done runs the checks, ticks the box and
 * makes the commit (spec.ts markTask). It reads the answer the page draws
 * (Task.tsx), so the two cannot disagree: accepted, the page turns to the
 * commit and this is the standing alone, the commit behind it on hover.
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
export function TaskStanding({ task }: { task: { spec: string; task: string } | null }) {
	const answer = useSyncExternalStore(taskStore.subscribe, taskStore.get);
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

	if (!task || answer?.type !== "task" || answer.spec !== task.spec || answer.task !== task.task) return null;

	if (answer.standing === "done") {
		return (
			<span
				id="taskStanding"
				className="flex h-7 shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground"
				title={`Accepted${answer.commit ? ` in ${answer.commit.short}, ${new Date(answer.commit.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}.`}
			>
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
				<Button id="taskStanding" variant="ghost" size="sm" disabled={accepting} className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground">
					{accepting ? <Spinner className="size-3.5 text-status-review" aria-label="accepting" /> : <TaskGlyph standing="review" />}
					{accepting ? "Accepting…" : "In review"}
					<ChevronDownIcon className="size-3 opacity-60" />
				</Button>
			</DropdownMenuTrigger>
			{/* At the header's end, so opened along its right edge rather than out past the window's. */}
			<DropdownMenuContent align="end" className="w-72">
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
