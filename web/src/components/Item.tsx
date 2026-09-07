import { memo } from "react";
import { CircleCheckIcon, InfoIcon } from "lucide-react";

import type { Item } from "../types";
import { Checkpoint, CheckpointIcon } from "./ai-elements/checkpoint";
import { Message, MessageContent, MessageResponse } from "./ai-elements/message";
import { ToolRow } from "./ToolRow";

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
export const ItemView = memo(function ItemView({ item }: { item: Item }) {
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

		case "tool":
			return <ToolRow item={item} />;

		case "error":
			return (
				<div className="rounded-md border border-destructive/50 px-3 py-2 text-destructive whitespace-pre-wrap">
					{item.text}
				</div>
			);

		// The end of a run. A rule with the word on it, rather than a line of
		// dashes centred in the column: a turn boundary is a mark in the flow,
		// and the flow is what the eye follows down the left edge.
		case "done":
			return (
				<Checkpoint>
					<CheckpointIcon>
						<CircleCheckIcon className="size-3.5 shrink-0" />
					</CheckpointIcon>
					<span className="px-1.5 text-xs">done</span>
				</Checkpoint>
			);

		// A notice is something that happened to the conversation without being
		// asked for — a compaction, a retry. Same mark as `done`, because it is
		// the same kind of thing: not a turn, but worth knowing a turn passed
		// through it. Amber said "warning", which a finished compaction is not.
		default:
			return (
				<Checkpoint>
					<CheckpointIcon>
						<InfoIcon className="size-3.5 shrink-0" />
					</CheckpointIcon>
					<span className="px-1.5 text-xs">{item.text}</span>
				</Checkpoint>
			);
	}
});
