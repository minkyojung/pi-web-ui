import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { CheckIcon, CopyIcon, Undo2Icon } from "lucide-react";

import { configStore, runUndoneStore } from "../serverState";
import { stopNote, turnParts } from "../turn";
import type { Item } from "../types";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The line under a finished run: how long it took, when it ended, what it
 * spent, and — only when it is worth saying — how it stopped.
 *
 * There is no tick in front of it. A run that finished is the ordinary case and
 * marking every one of them with a symbol spends the reader's attention on the
 * thing that is always true; what the line says is already only sayable about a
 * run that ended.
 */
/**
 * The conversation a footer sits in, for the one thing it needs from it.
 *
 * The answer a run produced used to ride on the item, which meant a session
 * file arrived carrying a second copy of every answer in it. The list is
 * already on screen; the footer only has to be told where to look, and the
 * list only has to hand over a way of looking that does not change on every
 * render, or every finished run would re-render on every delta.
 */
export const RunAnswer = createContext<(index: number) => string>(() => "");
/** Whether the run above a footer reached for a tool that writes notes — see wroteNotesAbove. */
export const RunWrote = createContext<(index: number) => boolean>(() => false);

export function TurnFooter({ item, index }: { item: Item; index: number }) {
	const parts = turnParts(item);
	const note = stopNote(item.stopReason);
	// Read while this row renders, which a memoized row does once. Walking the
	// list on every render would be a walk per finished run per delta.
	const answer = useContext(RunAnswer)(index);
	const wrote = useContext(RunWrote)(index);

	if (parts.length === 0 && !note && !answer && !wrote) return null;

	return (
		<div className="group/turn flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
			<span className="tabular-nums">{parts.join(" · ")}</span>
			{/* Not muted, and last, so it reads as the thing that interrupted the
			    run rather than another figure about it. */}
			{note && <span className="text-foreground">{note}</span>}
			{answer && <CopyAnswer text={answer} />}
			{wrote && item.startedAt !== undefined && item.endedAt !== undefined && <PutBackRun from={item.startedAt} to={item.endedAt} />}
		</div>
	);
}

/**
 * Put back what this run wrote in the notes — every note at once, which is
 * what Cursor and Zed offer on a run and what pressing Undo on each chunk in
 * each note would come to. It is the diff's Undo, applied wholesale: what the
 * person has kept stays kept, and what they typed since stays theirs.
 *
 * Offered on any run that reached for a writing tool; whether there is
 * anything left to put back is the record's to say, and the answer is shown
 * where the button was for a moment — the notes, or that there were none.
 */
function PutBackRun({ from, to }: { from: number; to: number }) {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const undone = useSyncExternalStore(runUndoneStore.subscribe, runUndoneStore.get);
	const [asked, setAsked] = useState<RunUndoneMsgRef | null>(null);
	const [said, setSaid] = useState<string | null>(null);

	// The answer to this footer's ask, and no other's: the store holds the last
	// one for the whole window, so it is claimed only after asking, once.
	useEffect(() => {
		if (!asked || !undone || undone === asked.seen) return;
		setAsked(null);
		setSaid(undone.notes.length === 0 ? "nothing left to put back" : `put back ${undone.notes.length === 1 ? undone.notes[0] : `${undone.notes.length} notes`}`);
		const timer = setTimeout(() => setSaid(null), 3000);
		return () => clearTimeout(timer);
	}, [asked, undone]);

	if (!config?.sessionId) return null;
	if (said) return <span className="text-foreground">{said}</span>;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label="Put back what this run wrote"
					className="opacity-0 transition-opacity group-hover/turn:opacity-100 focus-visible:opacity-100"
					disabled={asked !== null}
					onClick={() => {
						setAsked({ seen: undone });
						send({ type: "undo_run", session: config.sessionId, from, to });
					}}
				>
					<Undo2Icon />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">Put back what this run wrote</TooltipContent>
		</Tooltip>
	);
}

/** What the store held when the ask went out, so that the same answer is not read as the new one. */
type RunUndoneMsgRef = { seen: ReturnType<typeof runUndoneStore.get> };

/**
 * Copies what the run said — its assistant text, without the tool calls that
 * produced it, which is what someone reaching for a copy button wants to paste.
 *
 * Quiet until the row is pointed at, like the rest of this column.
 */
function CopyAnswer({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	// A copy that reports success for two seconds has to stop reporting it if
	// the row leaves the screen first, or the timer writes to a gone component.
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label="Copy the answer"
					className="opacity-0 transition-opacity group-hover/turn:opacity-100 focus-visible:opacity-100"
					onClick={() => {
						navigator.clipboard?.writeText(text).then(
							() => setCopied(true),
							// Clipboard access can be refused. Saying nothing is better than
							// claiming a copy that did not happen.
							() => {},
						);
					}}
				>
					{copied ? <CheckIcon /> : <CopyIcon />}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{copied ? "Copied" : "Copy the answer"}</TooltipContent>
		</Tooltip>
	);
}
