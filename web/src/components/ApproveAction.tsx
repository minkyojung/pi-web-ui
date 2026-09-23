import { useState, useSyncExternalStore } from "react";

import { commandsStore, configStore, specsStore } from "../serverState";
import { APPROVE, approveMessage, blocked, why } from "../specApprove.ts";
import { waitingLine } from "../specStanding.ts";
import { waitingPath } from "../specTabs.ts";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * In the header of a spec's document while it is waiting: the one word owed
 * to it.
 *
 * The document is read here, so the answer is asked for here — a person who
 * has just read the requirements should not have to go anywhere to say they
 * are right. It sits with the header's other controls (NoteHeader actions),
 * drawn as they are — no fill, the picker's height and size — and in the
 * text's colour where they are muted, which is all it takes to be the one
 * thing there that is waiting to be done. Which document, the crumbs beside
 * it say. Approving is the same command the control at the start of the tab
 * row sends (specApprove.ts), and both read the same state, so they cannot
 * say two different things.
 *
 * Only while that document is the one waiting. Approved, it goes: the next
 * document opens in a tab of its own and brings its own, and a control that
 * stays to say something has been done is one that has to be read every
 * time the document is opened afterwards. It was a line of its own over the
 * page once, which was a row of the window for one button.
 */
export function ApproveAction({ path }: { path: string | null }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const commands = useSyncExternalStore(commandsStore.subscribe, commandsStore.get);
	// The approval already sent, until the folder says something else.
	const [sent, setSent] = useState<string | null>(null);

	const spec = path === null || specs === null ? null : (specs.find((entry) => waitingPath(entry) === path) ?? null);
	if (!spec?.waiting) return null;

	const mark = `${spec.name}/${spec.waiting}`;
	const stop = blocked({
		online,
		streaming: config?.isStreaming ?? false,
		compacting: config?.isCompacting ?? false,
		hasCommand: commands.some((command) => command.name === APPROVE),
		sent: sent === mark,
	});
	const reason = why(stop);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{/* A disabled button gets no pointer events, so the tip hangs on a span round it. */}
				<span className="flex shrink-0">
					<Button
						id="approveSpec"
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						aria-label={waitingLine(spec.waiting)}
						disabled={stop !== null}
						onClick={() => {
							send(approveMessage(spec.name));
							setSent(mark);
						}}
					>
						Approve
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom">{reason ?? waitingLine(spec.waiting)}</TooltipContent>
		</Tooltip>
	);
}
