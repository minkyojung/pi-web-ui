import { createContext, useContext, useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { stopNote, turnParts } from "../turn";
import type { Item } from "../types";
import { Button } from "./ui/button";

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

export function TurnFooter({ item, index }: { item: Item; index: number }) {
	const parts = turnParts(item);
	const note = stopNote(item.stopReason);
	// Read while this row renders, which a memoized row does once. Walking the
	// list on every render would be a walk per finished run per delta.
	const answer = useContext(RunAnswer)(index);

	if (parts.length === 0 && !note && !answer) return null;

	return (
		<div className="group/turn flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
			<span className="tabular-nums">{parts.join(" · ")}</span>
			{/* Not muted, and last, so it reads as the thing that interrupted the
			    run rather than another figure about it. */}
			{note && <span className="text-foreground">{note}</span>}
			{answer && <CopyAnswer text={answer} />}
		</div>
	);
}

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
		<Button
			size="icon-xs"
			variant="ghost"
			title="Copy the answer"
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
	);
}
