import { useEffect, useState, useSyncExternalStore } from "react";

import { commandMessage } from "../pullRequestCommands";
import { commandsStore, configStore, noticesStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * A command of pi's, sent from a button at the foot of the window, and why
 * it cannot be now. Not while the agent works — a command is refused then,
 * not queued (specApprove.ts) — nor again once pressed, until the turn
 * starts or the server says something back, which is how a refusal comes;
 * nor where pi has no such command.
 */
export function useCommand(name: string): { why: string | null; run: (args?: string) => void } {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const commands = useSyncExternalStore(commandsStore.subscribe, commandsStore.get);
	const notices = useSyncExternalStore(noticesStore.subscribe, noticesStore.get);
	const busy = (config?.isStreaming ?? false) || (config?.isCompacting ?? false);
	const [sent, setSent] = useState(false);
	useEffect(() => setSent(false), [busy, notices]);
	const why = !online ? "Not connected" : busy ? "The agent is working" : !commands.some((command) => command.name === name) ? "Not loaded here" : sent ? "Asking the agent…" : null;
	return {
		why,
		run: (args) => {
			send(commandMessage(name, args));
			setSent(true);
		},
	};
}

/** Why a control is not pressable, on pointing at it — hung on a span, since a disabled button gets no pointer events. */
export function Why({ why, children }: { why: string | null; children: React.ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="flex shrink-0">{children}</span>
			</TooltipTrigger>
			{why && <TooltipContent side="top">{why}</TooltipContent>}
		</Tooltip>
	);
}

/** One command, one button: the strip's pressable shape — outline, small — its verb, and its icon. */
export function CommandButton({ name, id, children }: { name: string; id: string; children: React.ReactNode }) {
	const { why, run } = useCommand(name);
	return (
		<Why why={why}>
			<Button id={id} data-command={name} variant="outline" size="xs" className="cursor-default font-normal" disabled={why !== null} onClick={() => run()}>
				{children}
			</Button>
		</Why>
	);
}
