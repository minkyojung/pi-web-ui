import { memo } from "react";

import type { Item } from "../types";
import { Message, MessageContent, MessageResponse } from "./ai-elements/message";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./ai-elements/tool";

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
			return (
				// Open while it is running, so the partial output the reducer feeds in
				// is actually visible — a long bash call going silent is the failure
				// this whole line of work started from. It stays open afterwards,
				// since the state is uncontrolled and the user can collapse it. A tool
				// arriving from a snapshot is never pending, so revisited history
				// stays tidy. An error opens too: a collapsed card would hide it.
				<Tool defaultOpen={item.pending || item.isError}>
					<ToolHeader
						type={`tool-${item.name}`}
						// input-streaming never happens: the reducer opens the item at
						// tool_execution_start with the arguments already complete.
						state={
							item.pending || item.result == null
								? "input-available"
								: item.isError
									? "output-error"
									: "output-available"
						}
					/>
					<ToolContent>
						<ToolInput input={item.args} />
						<ToolOutput
							output={item.isError ? undefined : item.result}
							errorText={item.isError ? (item.result ?? undefined) : undefined}
						/>
					</ToolContent>
				</Tool>
			);

		case "error":
			return (
				<div className="rounded-md border border-destructive/50 px-3 py-2 text-destructive whitespace-pre-wrap">
					{item.text}
				</div>
			);

		case "done":
			return <div className="text-center text-xs text-muted-foreground">— done —</div>;

		default:
			return <div className="text-xs text-amber-600 dark:text-amber-500">{item.text}</div>;
	}
});
