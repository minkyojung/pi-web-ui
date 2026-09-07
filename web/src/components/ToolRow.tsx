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

import { toolDetail } from "../toolSummary";
import type { Item } from "../types";
import { CodeBlock } from "./ai-elements/code-block";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Spinner } from "./ui/spinner";

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

/** The tail of a tool's output so far — the sign that it is still alive. */
function lastLine(text: string | null | undefined): string | null {
	if (!text) return null;
	const lines = text.trimEnd().split("\n");
	return lines[lines.length - 1]?.trim() || null;
}

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
 * Closed by default, including on an error — a row that says which tool failed
 * is enough to decide whether to look. The exception is a tool still running:
 * its output is streaming in and there is nothing else on screen to say the
 * agent has not stalled, so the tail of that output rides along under the row
 * until it finishes. That was the whole reason cards used to spring open, and
 * it is the one part worth keeping.
 */
export function ToolRow({ item }: { item: Item }) {
	const detail = useContext(ToolSummaries) ? toolDetail(item.name, item.args) : null;
	const Icon = ICONS[item.name ?? ""] ?? WrenchIcon;
	// The reducer leaves `result` null until something comes back, so a tool with
	// neither a result nor an end is still on its way.
	const running = item.pending || item.result == null;
	const tail = running ? lastLine(item.result) : null;

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
				{running ? (
					<Spinner className="ml-auto size-3 shrink-0 text-muted-foreground" />
				) : item.isError ? (
					<CircleAlertIcon className="ml-auto size-3.5 shrink-0 text-destructive" />
				) : null}
			</CollapsibleTrigger>

			{tail && <div className="truncate pl-6 font-mono text-xs text-muted-foreground">{tail}</div>}

			<CollapsibleContent className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in">
				<div className="mt-1 mb-2 ml-[0.7rem] space-y-1 border-l pl-2 text-xs">
					<Field label="IN">
						{/* Unframed: the gutter already says where this starts, and a
						    border inside a row that has none of its own is a box back. */}
						<CodeBlock
							className="border-0 bg-muted/50"
							code={JSON.stringify(item.args ?? {}, null, 2)}
							language="json"
						/>
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
						</Field>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
