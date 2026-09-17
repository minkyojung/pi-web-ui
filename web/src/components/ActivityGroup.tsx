import { memo, type ReactNode } from "react";
import { BrainIcon, ChevronDownIcon, WrenchIcon } from "lucide-react";

import { summarise } from "../runSummary";
import type { Item } from "../types";
import { ItemView } from "./Item";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

/**
 * The steps of a finished run, folded into the line that says what they were.
 *
 * Closed by default and opened by hand. Which steps belong here, and why only
 * a run that has ended has any, is `rowsOf` in runSummary.ts.
 *
 * Not the registry's `task` or `chain-of-thought`: both are a Collapsible, a
 * trigger and a body with no state of their own, which is what the ui/
 * collapsible already is, and neither has the one thing this needed — a line
 * that knows what the steps under it did. `reasoning` has that shape and opens
 * and closes itself on a timer, which is the flicker ThinkingRow was cleared of.
 *
 * Memoized by hand: the row list is rebuilt on every delta, so the items array
 * is new each time even when nothing in it is. Comparing the contents is a walk
 * of a few entries; re-rendering every folded run of a long conversation on
 * every delta is what the reducer's one-item-per-event guarantee exists to stop.
 */
/** "1 tool", "2 tools" — the plural is the only thing that changes. */
function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export const ActivityGroup = memo(
	function ActivityGroup({ items, index }: { items: Item[]; index: number }) {
		const { tools, messages, failed } = summarise(items);
		// The wrench is what the row is mostly made of; a run that only thought
		// has no tool to speak for it and keeps the brain ThinkingRow uses.
		const Icon = tools ? WrenchIcon : BrainIcon;

		// Built as pieces rather than a string so the one piece that is not a
		// count — that some of the work failed — can be the one thing in the
		// line with a colour.
		const parts: ReactNode[] = [];
		if (tools) parts.push(<span>{count(tools, "tool")}</span>);
		if (messages) parts.push(<span>{count(messages, "message")}</span>);
		if (failed) parts.push(<span className="text-destructive">{failed} failed</span>);

		return (
			<Collapsible className="-my-1">
				<CollapsibleTrigger className="group/activity flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left font-normal hover:bg-muted/60">
					<Icon className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
						{parts.map((part, i) => (
							<span key={i}>
								{i > 0 && <span className="mx-1.5">·</span>}
								{part}
							</span>
						))}
					</span>
					{/* The rows are leaves and this is what holds them, which is worth
					    one mark of difference: nothing else in the column has a chevron. */}
					<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/activity:rotate-180" />
				</CollapsibleTrigger>

				<CollapsibleContent className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in">
					{/* The same rows as before, behind the same left edge an opened
					    thought sits behind, so opening this reads as going a level in
					    rather than as the run coming back. */}
					<div className="mt-1 mb-2 ml-[0.7rem] flex flex-col gap-1 border-l pl-3">
						{items.map((item, i) => (
							<ItemView key={index + i} item={item} index={index + i} />
						))}
					</div>
				</CollapsibleContent>
			</Collapsible>
		);
	},
	(before, after) =>
		before.index === after.index &&
		before.items.length === after.items.length &&
		before.items.every((item, i) => item === after.items[i]),
);
