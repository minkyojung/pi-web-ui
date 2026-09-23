import { useState, useSyncExternalStore } from "react";

import { commandsStore, configStore, specsStore } from "../serverState";
import { APPROVE, approveMessage, blocked, why } from "../specApprove.ts";
import { waitingLine } from "../specStanding.ts";
import { waitingPath } from "../specTabs.ts";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";

/**
 * Over a spec's document while it is waiting: that it is, and the button.
 *
 * The document is read here, so the answer is asked for here — a person who
 * has just read the requirements should not have to go anywhere to say they
 * are right. Approving is the same command the control at the start of the row
 * sends (specApprove.ts), and both read the same state, so they cannot say two
 * different things.
 *
 * Only while that document is the one waiting. Approved, the bar goes: the
 * next document opens in a tab of its own and brings its own bar, and a line
 * that stays to say something has been done is a line that has to be read
 * every time the document is opened afterwards.
 *
 * Outside the page rather than in it (App.tsx), so it does not scroll away
 * from a long document — and so that what scrolls is still the note's page,
 * which the editor and the checks both look up by its id.
 */
export function SpecBar({ path }: { path: string | null }) {
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
		<div id="specBar" role="status" className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted px-4 text-xs">
			<span className="min-w-0 flex-1 truncate">
				{waitingLine(spec.waiting)}
				{/* Why the button is not to be pressed, beside it rather than behind
				    a tooltip a disabled button would never show. */}
				{reason && <span className="text-muted-foreground"> · {reason}</span>}
			</span>
			<Button
				id="approveSpec"
				variant="outline"
				size="sm"
				className="h-7 text-xs"
				disabled={stop !== null}
				onClick={() => {
					send(approveMessage(spec.name));
					setSent(mark);
				}}
			>
				Approve
			</Button>
		</div>
	);
}
