import { useState, useSyncExternalStore } from "react";
import { CheckIcon, FileTextIcon, XIcon } from "lucide-react";

import { Spinner } from "./ui/spinner";

import { checkLogPath } from "../checkLog";
import { commitPath } from "../pages";
import { type ResultLine, checkMark, footWords, headWords, listOf } from "../resultsList.ts";
import { sawResults, seenStore } from "../seenResults.ts";
import { configStore, specsStore } from "../serverState";
import { docPath, speaksFor } from "../specStanding.ts";
import { TaskGlyph } from "./TaskGlyph";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
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
 * The button says the one thing that changes what a person does (footWords):
 * a task running, or what waits on them — in review, with the part not yet
 * looked at in the text's own colour — or else how far along. A queue of
 * tasks is set going and left, and coming back to it the question is what
 * is mine now; not how many lines it came to, which is a feeling and is in
 * the list. Nothing else that is true of the tasks earns a place down here.
 *
 * A Popover and not the strip's usual HoverCard, because what is in it is
 * pressed: a line opens that task's commit (Commit.tsx). A Command inside
 * it, as ⌘P and a crumb's folder are, for the arrows, Enter and narrowing by
 * a number or a word it brings. Its lines are under two small labels, In
 * Review and Done — what is yours, and what is over — the same words and the
 * same marks (TaskGlyph.tsx) as the plan's page. Opening it is looking:
 * everything in it is seen as far as its newest commit (seenResults.ts), and
 * what was new is marked for as long as the list stays up.
 *
 * Everything in it was already sent (SpecInfo.results); opening asks nobody.
 */
export function TaskResults({ open: inFront, onOpen }: { open: string | null; onOpen: (path: string) => void }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const seen = useSyncExternalStore(seenStore.subscribe, seenStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const [up, setUp] = useState(false);
	// What was seen when the list came up, so that what was new stays marked
	// while it is being read and not only for the instant before it is opened.
	const [seenThen, setSeenThen] = useState<string | null>(null);

	const spec = specs ? speaksFor(specs, inFront) : null;
	const running = spec && config?.run?.spec === spec.name ? config.run.task : null;
	// Nothing to say before a task has been run — the tab row already counts the plan.
	if (!spec || (spec.results.length === 0 && running === null)) return null;

	const list = listOf(spec.results, up ? seenThen : (seen[spec.name] ?? null));
	const words = footWords(spec.tasks, { fresh: up ? 0 : list.fresh, running }, list);
	// In review is the server's word (Progress.review); the rest of the lines are over.
	const review = new Set(spec.tasks?.review ?? []);
	const groups = [
		{ title: "In Review", standing: "review" as const, lines: list.lines.filter((line) => review.has(line.task)) },
		{ title: "Done", standing: "done" as const, lines: list.lines.filter((line) => !review.has(line.task)) },
	].filter((group) => group.lines.length > 0);
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
					{running !== null ? <Spinner className="size-3 shrink-0 text-status-progress" /> : <CheckIcon className="size-3 shrink-0" />}
					{/* The part that is news, in the text's own colour; the rest is
					    the strip's. Not while the list is up: it is being read. */}
					<span>
						{words.strong && <span className="text-foreground">{words.strong}</span>}
						{words.strong ? words.text.slice(words.strong.length) : words.text}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="w-96 p-0">
				<Command loop>
					<div className="flex items-baseline gap-2 px-3 pt-2.5 pb-1 text-xs">
						<span className="min-w-0 truncate font-medium text-foreground">{spec.name}</span>
						<span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
							<span style={{ color: "var(--code-string)" }}>+{list.added}</span> <span className="text-destructive">−{list.deleted}</span>
						</span>
					</div>
					{spec.tasks && <div className="px-3 pb-2 text-xs text-muted-foreground tabular-nums">{headWords(spec.tasks, running)}</div>}
					{/* Past a handful, a number or a word finds the one wanted. */}
					{list.lines.length > 6 && <CommandInput placeholder="Find a task…" />}
					<CommandList className="max-h-80">
						<CommandEmpty>No task by that.</CommandEmpty>
						{groups.map((group) => (
							<CommandGroup key={group.title} heading={group.title}>
								{group.lines.map((line) => (
									<CommandItem
										key={line.commit}
										value={`${line.task} ${line.title} ${line.short}`}
										data-result={line.task}
										data-fresh={line.fresh || undefined}
										title={`${line.short} · ${new Date(line.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${line.runs > 1 ? ` · run ${line.runs} times, this is the last` : ""}`}
										onSelect={() => go(commitPath(line.commit))}
										className="gap-2"
									>
										<Line line={line} standing={group.standing} onLog={go} />
									</CommandItem>
								))}
							</CommandGroup>
						))}
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

/**
 * One task's result, in one line: how it was checked, which task, and how
 * much it changed — what choosing which to open takes, and no more. The
 * commit and the time are reference, and are on the page the line opens;
 * here they are the line's title — with how many times the task was run,
 * when it was more than once. The line is its last run, and how many tries
 * it took is not what anybody opens the list to find out: a mark for it was
 * one more thing to learn, explained and still not understood.
 *
 * The mark before the diff is the checks. A filled circle: the run said it
 * checked its work, and says what in its title. A hollow one: it checked
 * nothing, which is the task worth opening. A circle and not a tick, because
 * a green tick has come to mean that something ran and passed, and this is
 * the agent's word — when the app runs checks of its own, this is where a
 * tick and a cross will stand.
 *
 * Not yet looked at is the line in bold, as unread mail is: nothing to
 * learn, and it leaves the one mark to mean one thing.
 */
function Line({ line, standing, onLog }: { line: ResultLine; standing: "review" | "done"; onLog: (path: string) => void }) {
	const checked = line.checks !== null;
	// What the app ran outranks what the run said (checkMark): a tick or a
	// cross where there is a Verified trailer, the circle for the agent's word otherwise.
	const ran = line.verified.length > 0 ? line.verified : null;
	const failed = ran?.filter((v) => v.exit !== 0) ?? [];
	const mark = checkMark(line);
	const title = ran
		? `${ran.map((v) => `${v.name} — ${v.exit === 0 ? "passed" : `exit ${v.exit}`}`).join(" · ")}${checked ? ` · agent: ${line.checks}` : ""}`
		: checked
			? `agent: ${line.checks}`
			: "The run checked nothing";
	return (
		<>
			<TaskGlyph standing={standing} />
			<span className="w-7 shrink-0 text-muted-foreground tabular-nums">{line.task}</span>
			<span className={`min-w-0 truncate ${line.fresh ? "font-semibold text-foreground" : ""}`}>{line.title}</span>
			{line.fresh && <span className="sr-only">new</span>}
			{/* A tick or a cross opens what the check printed — the first one that
			    failed, else the first — in a tab: the commit says how it ended, the
			    log says why. Its click is its own, not the line's. */}
			<span
				className={`ml-auto flex w-3 shrink-0 justify-center${ran ? " cursor-default" : ""}`}
				data-checks={mark}
				data-log={ran ? checkLogPath(line.task, (failed[0] ?? ran[0]!).name) : undefined}
				onClick={
					ran
						? (e) => {
								e.stopPropagation();
								onLog(checkLogPath(line.task, (failed[0] ?? ran[0]!).name));
							}
						: undefined
				}
				title={ran ? `${title} · click for what it printed` : title}
				role="img"
				aria-label={ran ? (failed.length === 0 ? `The app ran ${ran.length === 1 ? ran[0]!.name : `${ran.length} checks`}: passed` : `The app ran checks: ${failed.map((v) => v.name).join(", ")} failed`) : checked ? `The agent said it checked: ${line.checks}` : "No checks"}
			>
				{mark === "passed" ? (
					<CheckIcon className="size-3" style={{ color: "var(--code-string)" }} />
				) : mark === "failed" ? (
					<XIcon className="size-3 text-destructive" />
				) : checked ? (
					<span className="size-2 rounded-full bg-muted-foreground/70" />
				) : (
					<span className="size-2 rounded-full border border-amber-600 dark:border-amber-500" />
				)}
			</span>
			<span className="shrink-0 pl-2 text-[11px] tabular-nums">
				<span style={{ color: "var(--code-string)" }}>+{line.added}</span> <span className="text-destructive">−{line.deleted}</span>
			</span>
		</>
	);
}
