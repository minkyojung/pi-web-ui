/**
 * A spec's tasks.md read as what it is: the plan and how far it has got, a
 * row a task. ⌘E is the markdown, as it always was (readMode.ts); this is
 * what the file opens as.
 *
 * A row is skimmed — a glyph for where the task stands, its title, and once
 * it has run the size of its commit and how its check ended — and opened to
 * be read: what it involves, the requirements it is for, what proves it,
 * what it waits on. Colour is on the glyph (TaskGlyph.tsx) and a failed check.
 * Nothing folds away; a task set aside or done stays where the plan put it,
 * dimmed, so the order the plan has is the order the eye reads. By standing
 * instead is a toggle, for the person who wants the review pile in one place.
 *
 * What the person does to a task here is the command the box types for them
 * — /spec-run, /spec-done, /spec-cancel, /spec-reopen (taskList.ts) — as the
 * approvals are, so the terminal's pi does exactly the same. The rows are
 * taskList.ts's; this only draws them and sends the words.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckIcon, CircleDashedIcon, ListIcon, LayersIcon, PlayIcon, XIcon } from "lucide-react";

import { cn } from "cn";
import { APPROVED_DOCS, specNameOf } from "../../../documentKinds.ts";
import { checkLogPath } from "../checkLog";
import { commitPath, spansOf } from "../pages";
import { commandsStore, configStore, createStore, noteStore, specsStore } from "../serverState";
import { RUN, runBlocked, runMessage, runWhy } from "../specRun.ts";
import { docPath } from "../specStanding.ts";
import { TaskGlyph } from "./TaskGlyph";
import { getConnection, subscribe } from "../store";
import { byStatus, type ListRow, listOf, type Section, wordMessage, wordsFor } from "../taskList.ts";
import { send } from "../ws";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./ui/context-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Whether the list is by the plan's headings or by standing — the window's choice, the same in every workspace. */
const groupingStore = createStore<"plan" | "status">("plan", { window: true });

const chip = "h-5 cursor-default rounded px-1.5 font-normal text-[11px] tabular-nums text-muted-foreground hover:text-foreground";

function Row({ row, spec, started, canRun, why, onOpen, flat }: { row: ListRow; spec: string; started: boolean; canRun: boolean; why: string | null; onOpen: (path: string) => void; flat: boolean }) {
	const [open, setOpen] = useState(false);
	const parent = row.count !== null;
	const muted = row.standing === "done" || row.standing === "cancelled";
	const blocked = started && row.waits.length > 0;
	const detail = row.involves.length > 0 || row.requirements.length > 0 || (row.doneWhen && !row.latest) || row.after.length > 0;
	const words = wordsFor(row.standing);
	const latest = row.latest;
	const failed = latest?.verified.find((v) => v.exit !== 0) ?? null;
	const mark = latest === null ? null : latest.verified.length > 0 ? (failed ? "failed" : "passed") : latest.checks !== null ? "said" : "none";
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<CollapsibleTrigger asChild disabled={!detail || parent}>
						<div
							data-task={row.number}
							data-standing={row.standing}
							className={cn(
								"flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 hover:bg-accent/50",
								row.standing === "running" && "bg-status-progress/[0.06] hover:bg-status-progress/[0.09]",
								!flat && row.depth > 0 && "ml-6",
							)}
						>
							<TaskGlyph standing={row.standing} blocked={blocked} />
							<span className={cn("min-w-0 flex-1 truncate text-sm", (muted || (blocked && !muted)) && "text-muted-foreground", row.standing === "cancelled" && "line-through", parent && "font-medium")}>
								{row.title}
							</span>
							<span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
								{row.count && <span>{row.count.done} / {row.count.total}</span>}
								{latest && <span className="text-muted-foreground/70">+{latest.added} −{latest.deleted}</span>}
								{latest && mark && (
									<HoverCard openDelay={250} closeDelay={150}>
										<HoverCardTrigger asChild>
											<button
												className="flex items-center"
												aria-label="how the check ended"
												onClick={(e) => {
													e.stopPropagation();
													const check = failed ?? latest.verified[0];
													if (check) onOpen(checkLogPath(row.number, check.name));
													else onOpen(commitPath(latest.commit));
												}}
											>
												{mark === "passed" && <CheckIcon className="size-3.5 text-muted-foreground/70" />}
												{mark === "failed" && <XIcon className="size-3.5 text-destructive/60" />}
												{(mark === "said" || mark === "none") && <CircleDashedIcon className="size-3.5 text-muted-foreground/50" />}
											</button>
										</HoverCardTrigger>
										<HoverCardContent side="bottom" align="end" className="w-96 p-0 text-left">
											<div className="space-y-1 px-3 py-2 font-mono text-[12px]">
												{latest.verified.length === 0 && <div className="text-muted-foreground">{latest.checks ? `The agent said: ${latest.checks}` : "Nothing was checked."}</div>}
												{latest.verified.map((v) => (
													<div key={v.name} className="flex items-center gap-2">
														<PlayIcon className="size-3 shrink-0 text-muted-foreground/60" />
														<span className="min-w-0 flex-1 truncate">{v.name}</span>
														<span className={cn("shrink-0 text-[11px]", v.exit === 0 ? "text-muted-foreground" : "text-destructive/80")}>exit {v.exit}</span>
													</div>
												))}
											</div>
											<div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground/70">{latest.verified.length > 0 ? "Click to open what it printed" : "Click to open the commit"}{row.tries > 1 && ` · ${row.tries} runs`}</div>
										</HoverCardContent>
									</HoverCard>
								)}
							</span>
						</div>
					</CollapsibleTrigger>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-56">
					{!parent && row.standing !== "running" && row.standing !== "done" && (
						<ContextMenuItem disabled={!canRun} title={why ?? undefined} onSelect={() => send(runMessage(spec, [row.number]))}>
							<PlayIcon />{row.standing === "review" ? "Run again" : "Run this task"}
						</ContextMenuItem>
					)}
					{words.includes("done") && <ContextMenuItem disabled={!canRun} onSelect={() => send(wordMessage("done", spec, row.number))}><CheckIcon />Done — accept it</ContextMenuItem>}
					{latest && <ContextMenuItem onSelect={() => onOpen(commitPath(latest.commit))}>Open the commit</ContextMenuItem>}
					{row.requirements.length > 0 && <ContextMenuItem onSelect={() => onOpen(docPath(spec, "requirements.md"))}>Open the requirements</ContextMenuItem>}
					<ContextMenuSeparator />
					{words.includes("reopen") && <ContextMenuItem disabled={!canRun} onSelect={() => send(wordMessage("reopen", spec, row.number))}>Open it again</ContextMenuItem>}
					{words.includes("cancel") && <ContextMenuItem variant="destructive" disabled={!canRun} onSelect={() => send(wordMessage("cancel", spec, row.number))}>Set aside</ContextMenuItem>}
				</ContextMenuContent>
			</ContextMenu>
			<CollapsibleContent>
				<div className={cn("mb-2.5 ml-[2.4rem] space-y-1.5 text-[13px] text-muted-foreground", !flat && row.depth > 0 && "ml-[3.9rem]")}>
					{row.involves.map((line) => <p key={line}>{line}</p>)}
					{row.doneWhen && !latest && (
						<div className="flex items-center gap-1.5 font-mono text-[12px]">
							<PlayIcon className="size-3 text-muted-foreground/60" />
							<span>{spansOf(row.doneWhen).map((span, i) => (span.code ? <code key={i} className="rounded bg-muted px-1">{span.text}</code> : <span key={i}>{span.text}</span>))}</span>
						</div>
					)}
					{(row.requirements.length > 0 || row.after.length > 0) && (
						<div className="flex flex-wrap items-center gap-1.5">
							{row.requirements.map((r) => (
								<Tooltip key={r}>
									<TooltipTrigger asChild>
										<Badge variant="secondary" className={chip} onClick={() => onOpen(docPath(spec, "requirements.md"))}>{r}</Badge>
									</TooltipTrigger>
									<TooltipContent side="bottom">Requirement {r} — open the requirements</TooltipContent>
								</Tooltip>
							))}
							{row.after.map((n) => (
								<Tooltip key={n}>
									<TooltipTrigger asChild>
										<Badge variant="outline" className={chip}>⇢ {n}</Badge>
									</TooltipTrigger>
									<TooltipContent side="bottom">after {n}</TooltipContent>
								</Tooltip>
							))}
						</div>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function SectionView({ section, ...rest }: { section: Section; spec: string; started: boolean; canRun: boolean; why: string | null; onOpen: (path: string) => void; flat: boolean }) {
	return (
		<section className="mb-5">
			{section.title !== null && (
				<div className="mb-1 flex h-7 items-center justify-between px-2">
					<h3 className="text-xs font-medium text-muted-foreground">{section.title}</h3>
					{section.total > 0 && <span className="text-xs tabular-nums text-muted-foreground/60">{section.done} / {section.total}</span>}
				</div>
			)}
			{section.rows.map((row) => <Row key={row.number} row={row} {...rest} />)}
		</section>
	);
}

export function TaskList({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
	const note = useSyncExternalStore(noteStore.subscribe, noteStore.get);
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const commands = useSyncExternalStore(commandsStore.subscribe, commandsStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const grouping = useSyncExternalStore(groupingStore.subscribe, groupingStore.get);
	// Asked for whenever there is a socket to ask on, as the editor asks: the
	// answer is the file whole, and comes again whenever the file changes.
	useEffect(() => {
		if (online) send({ type: "open_note", path });
	}, [online, path]);
	const name = specNameOf(path);
	const spec = name === null ? null : (specs?.find((entry) => entry.name === name) ?? null);
	const text = note?.path === path ? note.text : null;
	if (name === null || text === null) return <div id="tasks" className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Opening…</div>;
	const running = config?.run?.spec === name ? config.run.task : null;
	const list = listOf(text, { results: spec?.results ?? [], review: spec?.review ?? [], running });
	const stop = spec && config ? runBlocked({ online, streaming: config.isStreaming, compacting: config.isCompacting, hasCommand: commands.some((command) => command.name === RUN), spec, count: 1, sent: false }) : "offline";
	const canRun = stop === null;
	const why = runWhy(stop);
	const sections = grouping === "status" ? byStatus(list) : list.sections;
	const notReady = spec !== null && (spec.approved < APPROVED_DOCS.length || !spec.written.includes("tasks.md"));
	return (
		<div id="tasks" className="no-scrollbar edge-top flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div className="mx-auto w-full max-w-[68ch] px-6 py-5">
				<div className="mb-4 flex items-center gap-2">
					{list.head && <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{list.head.replace(/^#+\s*/, "").split("\n")[0]}</h1>}
					{/* Which task /spec-run would start, from the server's reading of the plan (Progress.next): no row is marked as next. */}
					{spec?.tasks?.next && <span id="next" className="shrink-0 text-xs text-muted-foreground">next is {spec.tasks.next}</span>}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button id="grouping" variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground" aria-label={grouping === "plan" ? "Group by standing" : "In the plan's order"} onClick={() => groupingStore.set(grouping === "plan" ? "status" : "plan")}>
								{grouping === "plan" ? <LayersIcon /> : <ListIcon />}
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">{grouping === "plan" ? "Group by standing" : "In the plan's order"}</TooltipContent>
					</Tooltip>
				</div>
				{notReady && <p className="mb-4 text-xs text-muted-foreground">{why ?? "Approve the requirements and the design first."}</p>}
				{sections.map((section, i) => <SectionView key={section.title ?? i} section={section} spec={name} started={list.started} canRun={canRun} why={why} onOpen={onOpen} flat={grouping === "status"} />)}
				{list.sections.length === 0 && <p className="text-sm text-muted-foreground">No tasks yet.</p>}
			</div>
		</div>
	);
}
