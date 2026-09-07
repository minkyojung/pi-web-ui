import { createContext, useContext, type ReactNode } from "react";
import { cn } from "cn";
import {
	CircleAlertIcon,
	FilePenIcon,
	FilePlusIcon,
	FileSearchIcon,
	FileTextIcon,
	FolderIcon,
	QuoteIcon,
	SearchIcon,
	TerminalIcon,
	WrenchIcon,
} from "lucide-react";

import { detailNotes, diffStat } from "../toolDetails";
import { toolDetail } from "../toolSummary";
import type { Item } from "../types";
import { CodeBlock } from "./ai-elements/code-block";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

/**
 * Whether a tool row carries a summary of what it touched.
 *
 * Always on in the app — the default is the answer. It exists so the gallery
 * can turn it off and show the same run both ways, which is the only way to
 * judge a change to the summary against what it replaced.
 */
export const ToolSummaries = createContext(true);

/** What each tool does, at a glance. Unknown tools keep the generic wrench. */
const ICONS: Record<string, typeof WrenchIcon> = {
	read: FileTextIcon,
	write: FilePlusIcon,
	edit: FilePenIcon,
	ls: FolderIcon,
	find: FileSearchIcon,
	grep: SearchIcon,
	bash: TerminalIcon,
	powershell: TerminalIcon,
	set_gist: QuoteIcon,
};

/**
 * What went in, and what came back.
 *
 * The label sits in a gutter rather than on a line of its own above the value,
 * which is what "Parameters" and "Result" needed at that length. Two words
 * become two marks down the left edge, the block starts on the same line it is
 * labelled, and an opened tool is two lines shorter.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex gap-2">
			<span className="w-6 shrink-0 pt-1 font-mono text-[10px] text-muted-foreground">{label}</span>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

/**
 * The change an edit made, as pi wrote it.
 *
 * Its own renderer rather than the code block's `diff` grammar: pi numbers
 * every line and puts the mark before the number, which is not the format that
 * grammar is looking for, and colouring by first character is the whole of what
 * a diff needs anyway.
 */
function Diff({ diff }: { diff: string }) {
	return (
		<div className="max-h-72 overflow-auto rounded-md bg-muted/50 py-1 font-mono text-xs">
			{diff.split("\n").map((line, i) => (
				<div
					key={i}
					className={cn(
						"px-2 whitespace-pre",
						line.startsWith("+") && "bg-green-500/10 text-green-700 dark:text-green-400",
						line.startsWith("-") && "bg-red-500/10 text-red-700 dark:text-red-400",
					)}
				>
					{line || " "}
				</div>
			))}
		</div>
	);
}

/**
 * One tool call, as a line rather than a card.
 *
 * A run is mostly tool calls, and a bordered card each turns eight of them into
 * a column of boxes that has to be scrolled past to find the sentence after it.
 * So the frame is gone and what is left is a row: an icon, the tool, and what
 * it touched. Everything else opens on click.
 *
 * Nothing here is bold. Weight is what a card used to spend to separate its
 * header from its body; a row has no body to separate itself from, and eight
 * rows of it read as eight headings.
 *
 * Closed, always — including while it runs and including on an error. A row
 * that says which tool failed is enough to decide whether to look, and nothing
 * is shown for a tool still working: a run is read after it happens far more
 * often than while it happens, and anything that appears for the second a tool
 * takes and then leaves turns the list into a column of flicker. The only mark
 * a row carries is the one that outlives the run, which is a failure.
 */
export function ToolRow({ item }: { item: Item }) {
	const detail = useContext(ToolSummaries) ? toolDetail(item.name, item.args) : null;
	const Icon = ICONS[item.name ?? ""] ?? WrenchIcon;
	const diff = item.details?.diff;
	const stat = diff ? diffStat(diff) : null;
	const notes = detailNotes(item.details);

	return (
		// Pulled in against the conversation's own spacing: a paragraph and a tool
		// call want air between them, two tool calls do not. The list is one
		// column with one gap, so the tighter of the two is taken back here.
		<Collapsible className="-my-1">
			{/* No disclosure arrow. A row with nothing worth opening is the common
			    case, and a caret on every one of eight rows is a column of marks
			    that has to be looked past. The row highlights when pointed at,
			    which is the same offer with nothing standing there to make it. */}
			<CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left font-normal hover:bg-muted/60">
				<Icon className="size-3.5 shrink-0 text-muted-foreground" />
				{/* Body size, like the assistant's own text: a tool call is part of
				    the same account of what happened, not a footnote under it. The
				    step down to a quieter row is made in colour alone — the name a
				    shade off full contrast, the detail a shade further. */}
				<span className="shrink-0 text-sm font-normal text-foreground/80">{item.name}</span>
				{detail && <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">{detail}</span>}
				{/* What the row is not showing, next to what it is: a result that
				    was cut short, or a search that stopped where it was told to. */}
				{notes.map((note) => (
					<span key={note} className="ml-auto shrink-0 text-xs text-muted-foreground">
						{note}
					</span>
				))}
				{stat && (
					<span className="ml-auto shrink-0 text-xs tabular-nums">
						<span className="text-green-600 dark:text-green-500">+{stat.added}</span>{" "}
						<span className="text-red-600 dark:text-red-500">−{stat.removed}</span>
					</span>
				)}
				{item.isError && <CircleAlertIcon className="ml-auto size-3.5 shrink-0 text-destructive" />}
			</CollapsibleTrigger>

			<CollapsibleContent className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in">
				<div className="mt-1 mb-2 ml-[0.7rem] space-y-1 border-l pl-2 text-xs">
					<Field label="IN">
						{/* An edit's arguments are the change, written as the text on
						    either side of it; pi has already worked out what that comes
						    to. Showing the JSON instead would be showing the worse of
						    two accounts of the same thing.

						    Unframed either way: the gutter already says where this
						    starts, and a border inside a row that has none of its own
						    is a box back. */}
						{diff ? (
							<Diff diff={diff} />
						) : (
							<CodeBlock
								className="border-0 bg-muted/50"
								code={JSON.stringify(item.args ?? {}, null, 2)}
								language="json"
							/>
						)}
					</Field>

					{item.result != null && (
						<Field label="OUT">
							{/* A tool result is whatever the tool printed — shell output, a
							    file, a diff — so it is shown as-is rather than highlighted
							    as JSON the way the registry's component does, and capped:
							    a grep over a large tree would otherwise be pages long. */}
							<pre
								className={cn(
									"max-h-72 overflow-auto rounded-md p-2 whitespace-pre-wrap",
									item.isError ? "bg-destructive/10 text-destructive" : "bg-muted/50",
								)}
							>
								{item.result}
							</pre>
							{/* Where the rest of it went. Long, and of no use until the
							    output is opened, so it waits down here rather than
							    crowding the row. */}
							{item.details?.fullOutputPath && (
								<p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
									full output: {item.details.fullOutputPath}
								</p>
							)}
						</Field>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
