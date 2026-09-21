import { useState, useSyncExternalStore } from "react";
import { CheckIcon, FileTextIcon } from "lucide-react";

import { commitPath } from "../pages";
import { type ResultLine, freshWords, listOf, tasksWords } from "../resultsList.ts";
import { sawResults, seenStore } from "../seenResults.ts";
import { specsStore } from "../serverState";
import { docPath, speaksFor } from "../specStanding.ts";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * What a spec's tasks have come to, at the foot of the window: how many are
 * done, how many of those have not been looked at, and behind it the list.
 *
 * The plan is tasks.md and stays the plan; the record of what running it
 * left is here, reachable from whatever is in front — a file being read, a
 * note, the plan itself. It speaks for the spec the control at the start of
 * the tab row speaks for (speaksFor), so the two cannot name different ones.
 *
 * The button says one thing that changes what a person does: that there is
 * something they have not seen. A queue of tasks is set going and left, and
 * coming back to it the question is which of these are new — not how many
 * lines they came to, which is a feeling and is in the list. Nothing else
 * that is true of the results earns a place down here.
 *
 * A Popover and not the strip's usual HoverCard, because what is in it is
 * pressed: a line opens that task's commit (Commit.tsx). A Command inside
 * it, as ⌘P and a crumb's folder are, for the arrows, Enter and narrowing by
 * a number or a word it brings. Opening it is looking: everything in it is
 * seen as far as its newest commit (seenResults.ts), and what was new is
 * marked for as long as the list stays up.
 *
 * Everything in it was already sent (SpecInfo.results); opening asks nobody.
 */
export function TaskResults({ open: inFront, onOpen }: { open: string | null; onOpen: (path: string) => void }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const seen = useSyncExternalStore(seenStore.subscribe, seenStore.get);
	const [up, setUp] = useState(false);
	// What was seen when the list came up, so that what was new stays marked
	// while it is being read and not only for the instant before it is opened.
	const [seenThen, setSeenThen] = useState<string | null>(null);

	const spec = specs ? speaksFor(specs, inFront) : null;
	if (!spec || spec.results.length === 0) return null;

	const list = listOf(spec.results, up ? seenThen : (seen[spec.name] ?? null));
	const fresh = freshWords(list);
	const go = (path: string) => {
		setUp(false);
		onOpen(path);
	};
	return (
		<Popover
			open={up}
			onOpenChange={(next) => {
				if (next) {
					setSeenThen(seen[spec.name] ?? null);
					if (list.newest) sawResults(spec.name, list.newest);
				}
				setUp(next);
			}}
		>
			<PopoverTrigger asChild>
				<Button id="results" variant="ghost" size="sm" className="cursor-default gap-1 px-1.5 text-xs font-normal" title={`What ${spec.name}'s tasks came to`} data-fresh={list.fresh}>
					<CheckIcon className="size-3 shrink-0" />
					<span>{tasksWords(list)}</span>
					{/* The one part that is news, in the text's own colour; the rest
					    is the strip's. Not while the list is up: it is being read. */}
					{fresh && !up && <span className="text-foreground">· {fresh}</span>}
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="w-[28rem] p-0">
				<Command loop>
					<div className="flex items-baseline gap-2 px-3 pt-2.5 pb-1 text-xs">
						<span className="min-w-0 truncate font-medium text-foreground">{spec.name}</span>
						<span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
							{tasksWords(list)} · <span style={{ color: "var(--code-string)" }}>+{list.added}</span> <span className="text-destructive">−{list.deleted}</span>
						</span>
					</div>
					{/* Past a handful, a number or a word finds the one wanted. */}
					{list.lines.length > 6 && <CommandInput placeholder="Find a task…" />}
					<CommandList className="max-h-80">
						<CommandEmpty>No task by that.</CommandEmpty>
						<CommandGroup>
							{list.lines.map((line) => (
								<CommandItem key={line.commit} value={`${line.task} ${line.title} ${line.short}`} data-result={line.task} data-fresh={line.fresh || undefined} onSelect={() => go(commitPath(line.commit))} className="items-start gap-2 py-1.5">
									<Line line={line} />
								</CommandItem>
							))}
						</CommandGroup>
						<CommandSeparator />
						<CommandGroup>
							<CommandItem value="open tasks.md the plan" onSelect={() => go(docPath(spec.name, "tasks.md"))}>
								<FileTextIcon />
								Open tasks.md
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/** One task's result: which, its commit and how much, and under that how it was checked and when. */
function Line({ line }: { line: ResultLine }) {
	return (
		<>
			{/* The mark for not yet looked at, in a column of its own so the
			    numbers under it stay in line whether or not it is there. */}
			<span className="mt-1.5 flex w-1.5 shrink-0 justify-center" aria-hidden>
				{line.fresh && <span className="size-1.5 rounded-full bg-foreground" />}
			</span>
			<span className="w-7 shrink-0 text-muted-foreground tabular-nums">{line.task}</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="min-w-0 truncate">{line.title}</span>
					{line.runs > 1 && (
						<Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] font-normal text-muted-foreground tabular-nums" title={`Run ${line.runs} times; this is the last`}>
							×{line.runs}
						</Badge>
					)}
					{line.fresh && <span className="sr-only">new</span>}
				</span>
				{/* The run's own word for its checks, said to be the agent's —
				    nothing here ran it — and its absence said too, since a task
				    that checked nothing is the one worth opening. */}
				<span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
					{line.checks ? <span className="min-w-0 truncate">agent: {line.checks}</span> : <span className="text-amber-600 dark:text-amber-500">no checks</span>}
				</span>
			</span>
			<span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] text-muted-foreground tabular-nums">
				<span className="flex items-center gap-1.5">
					<span className="font-mono">{line.short}</span>
					<span>
						<span style={{ color: "var(--code-string)" }}>+{line.added}</span> <span className="text-destructive">−{line.deleted}</span>
					</span>
				</span>
				<span>{new Date(line.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
			</span>
		</>
	);
}
