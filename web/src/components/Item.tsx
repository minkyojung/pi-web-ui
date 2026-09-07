import { memo } from "react";
import { CircleAlertIcon, InfoIcon } from "lucide-react";

import type { Item } from "../types";
import { Message, MessageContent, MessageResponse } from "./ai-elements/message";
import { ThinkingRow } from "./ThinkingRow";
import { ToolRow } from "./ToolRow";
import { TurnFooter } from "./TurnFooter";

/**
 * One conversation item.
 *
 * A tool call is a top-level item here, not a part inside an assistant message,
 * so this stays a dispatcher: one item in, one component out. Grouping runs of
 * items into a single message would mean a delta into the last of them
 * re-rendering the whole group, which is what the reducer's one-item-per-event
 * guarantee exists to avoid.
 *
 * Memoized on the item object, which the store replaces only when the reducer
 * says that item changed — so a delta re-renders the one row it landed in.
 */
export const ItemView = memo(function ItemView({ item, index }: { item: Item; index: number }) {
	switch (item.kind) {
		case "user":
			// Deliberately not markdown: a * or a # the user typed is literal.
			return (
				<Message from="user">
					<MessageContent className="whitespace-pre-wrap">{item.text}</MessageContent>
				</Message>
			);

		case "assistant":
			return (
				// w-full, not the component's default w-fit: the assistant's output is
				// mostly code blocks, and sizing to content folds them into a column.
				<Message from="assistant" className="max-w-full">
					<MessageContent className="w-full">
						<MessageResponse>{item.text}</MessageResponse>
					</MessageContent>
				</Message>
			);

		case "thinking":
			return <ThinkingRow text={item.text ?? ""} />;

		case "tool":
			return <ToolRow item={item} />;

		// A row like the rest of the column, since it is the same kind of thing —
		// something that happened on the way to an answer. It keeps the
		// destructive colour, which is what a border was being spent on.
		case "error":
			return (
				<div className="flex items-start gap-1.5 px-1 text-sm text-destructive">
					<CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
					<span className="min-w-0 whitespace-pre-wrap">{item.text}</span>
				</div>
			);

		// The end of a run.
		case "done":
			return <TurnFooter item={item} index={index} />;

		// A notice is something that happened to the conversation without being
		// asked for — a compaction, a retry. A sentence, so it is allowed to wrap
		// across the full width, with the icon held to its first line. Amber said
		// "warning", which a finished compaction is not.
		default:
			return (
				<div className="flex items-start gap-1.5 px-1 text-sm text-muted-foreground">
					<InfoIcon className="mt-0.5 size-3.5 shrink-0" />
					<span className="min-w-0">{item.text}</span>
				</div>
			);
	}
});
