import { useEffect, useState, useSyncExternalStore } from "react";

import { commandsStore, configStore, noticesStore, taskStore } from "../serverState";
import { blocked, why } from "../specApprove.ts";
import { wordMessage } from "../taskList.ts";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * In the header of a task's page while its run waits to be looked at: the
 * word owed to it, as Approve is a document's (ApproveAction.tsx).
 *
 * The page is where the person decides, so the deciding is done there. It is
 * the command the plan's menu sends (taskList.ts wordMessage) — /spec-done
 * runs the checks, ticks the box and makes the commit (spec.ts markTask) —
 * and it reads the answer the page itself draws, so the two cannot disagree:
 * accepted, the page turns to the commit and this goes.
 *
 * "Accepting…" from the press until the command has said how it ended. The
 * checks can take as long as they take, and a check that refuses leaves the
 * task in review — so neither a timer nor the page moving will do; what does
 * is that every way the command ends says something (noticesStore). Pressed
 * again before that, a second acceptance would run beside the first.
 */
export function AcceptAction({ task }: { task: { spec: string; task: string } | null }) {
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

	if (!task || answer?.type !== "task" || answer.spec !== task.spec || answer.task !== task.task || answer.standing !== "review") return null;

	const mark = `${task.spec}/${task.task}`;
	const stop = blocked({
		online,
		streaming: config?.isStreaming ?? false,
		compacting: config?.isCompacting ?? false,
		hasCommand: commands.some((command) => command.name === "spec-done"),
		sent: sent?.mark === mark && sent.notices === notices,
	});
	const reason = stop === "sent" ? "Accepting…" : why(stop);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{/* A disabled button gets no pointer events, so the tip hangs on a span round it. */}
				<span className="flex shrink-0">
					<Button
						id="acceptTask"
						variant="soft"
						size="sm"
						className="h-7 px-2 text-xs text-status-done"
						aria-label={`Accept task ${task.task}`}
						disabled={stop !== null}
						onClick={() => {
							send(wordMessage("done", task.spec, task.task));
							setSent({ mark, notices });
						}}
					>
						Accept
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom">{reason ?? "Run the checks, tick the box and commit what the run changed"}</TooltipContent>
		</Tooltip>
	);
}
