/**
 * Running tasks from the window: the same command, sent for the person.
 *
 * There is no running in the window, as there is no approving in it
 * (specApprove.ts). `/spec-run` is the run — the code behind it opens the
 * session, and at the turn's end checks the box and commits (spec.ts) — so
 * what a control does is type the command and press send. With several
 * tasks it types them all, and they run one after another, each in a session
 * of its own, the next as the one before it is committed.
 *
 * Which tasks, is read off the document in front: the lines a selection
 * covers, and of those the ones that are tasks, by the same reading of a
 * line the run itself makes (specTasks.ts). A heading with sub-tasks means
 * all of them still to do — Kiro's Start on a heading — so a selection over
 * a whole section yields the heading and folds its sub-tasks into it; what
 * is already done, or a heading with nothing left under it, is left out,
 * since the command refuses it.
 *
 * What may stop it is here too, for the same reason as approving: a
 * command sent while the agent is working is refused, not queued, so a
 * control that would only earn that warning is disabled and says why.
 *
 * Pure. The stores are read where they are drawn.
 */
import type { ClientMsg, SpecInfo } from "../../protocol.ts";
import { APPROVED_DOCS } from "../../documentKinds.ts";
import { runsUnder, type Task, taskAt } from "../../specTasks.ts";

/** Its name on pi's list of commands (CommandsMsg), which is how the window knows it is there. */
export const RUN = "spec-run";

/** How the run may be asked to be done: on a model, at an effort — spec.ts reads these words. */
export interface RunOn {
	/** `provider/id`, as the picker keys a model. */
	model?: string | null;
	effort?: string | null;
}

/**
 * What the person would type. The spec's name is always given, so that the
 * question pi asks when several specs are ready never has to be answered
 * here; the numbers in the order given, which is the order they run in.
 */
export function runCommand(spec: string, numbers: readonly string[], on: RunOn = {}): string {
	return ["/" + RUN, spec, ...numbers, ...(on.model ? [on.model] : []), ...(on.effort ? [on.effort] : [])].join(" ");
}

/** And what the box sends when they do — see Composer.tsx. */
export const runMessage = (spec: string, numbers: readonly string[], on: RunOn = {}): ClientMsg => ({ type: "prompt", text: runCommand(spec, numbers, on), command: true, behavior: "followUp" });

/**
 * The tasks a selection of `text` from `from` to `to` covers, in the order
 * they stand: every line the range touches, even by a character, and of
 * those the ones that are tasks still to do and are work of their own. An
 * empty selection is the line the cursor is on.
 *
 * One exception, which is the rule editors count selected lines by: a
 * selection that ends at the very start of a line has not touched that line
 * — it took the newline before it and nothing of it. A drag is a tool for
 * words and overshoots by a newline as often as not; without this, the
 * task after the last one meant would come along.
 */
export function tasksBetween(text: string, from: number, to: number): Task[] {
	let [start, end] = from <= to ? [from, to] : [to, from];
	if (end > start && text[end - 1] === "\n") end -= 1;
	const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
	let lineEnd = text.indexOf("\n", end);
	if (lineEnd === -1) lineEnd = text.length;
	const covered = text
		.slice(lineStart, lineEnd)
		.split("\n")
		.map(taskAt)
		.filter((task): task is Task => task !== null);
	const all = text
		.split("\n")
		.map(taskAt)
		.filter((task): task is Task => task !== null);
	return foldRuns(all, covered);
}

/**
 * Of `chosen`, the ones that are runs: with something left to do, and not
 * under another chosen one — `2` covered folds `2.2` into it, since the
 * heading's run is all of its sub-tasks.
 */
function foldRuns(all: Task[], chosen: Task[]): Task[] {
	const runnable = chosen.filter((task) => (runsUnder(all, task.number)?.length ?? 0) > 0);
	return runnable.filter((task) => !runnable.some((other) => task.number.startsWith(`${other.number}.`)));
}

/** What a heading's Start would run, for its title: `2.1, 2.2`; empty for a task that is its own run. */
export function underOf(text: string, number: string): string[] {
	const all = text
		.split("\n")
		.map(taskAt)
		.filter((task): task is Task => task !== null);
	const runs = runsUnder(all, number) ?? [];
	return runs.length === 1 && runs[0]!.number === number ? [] : runs.map((task) => task.number);
}

/**
 * The lines a Start belongs on: each task with something left to do, with
 * where its line begins — a task of its own not done, or a heading with a
 * sub-task not done, whose Start is all of them (Kiro's). A task done, or a
 * heading with nothing left under it, has none: the command refuses it. By
 * offset into `text`, which is what a decoration wants; the text is the
 * document's, so a line is what the document says it is, `\r` and all.
 */
export function startLines(text: string): { from: number; task: Task }[] {
	const lines = text.split("\n");
	const all = lines.map(taskAt);
	const tasks = all.filter((task): task is Task => task !== null);
	const out: { from: number; task: Task }[] = [];
	let from = 0;
	for (let at = 0; at < lines.length; at++) {
		const task = all[at];
		if (task && (runsUnder(tasks, task.number)?.length ?? 0) > 0) out.push({ from, task });
		from += lines[at]!.length + 1;
	}
	return out;
}

/**
 * The lines a result belongs on: each task done that is work of its own, with
 * where its line ends — which is where what it came to is said (taskCommit.ts).
 * A heading has no line of its own here: its sub-tasks each ended in a commit
 * and it ended in none. By offset into `text`, the end of the line's words —
 * before a `\r`, which is the line's ending and not its end.
 */
export function doneLines(text: string): { to: number; task: Task }[] {
	const lines = text.split("\n");
	const all = lines.map(taskAt);
	const tasks = all.filter((task): task is Task => task !== null);
	const out: { to: number; task: Task }[] = [];
	let from = 0;
	for (let at = 0; at < lines.length; at++) {
		const task = all[at];
		const line = lines[at]!;
		const heading = task !== null && tasks.some((other) => other.number.startsWith(`${task!.number}.`));
		if (task && task.done && !heading) out.push({ to: from + line.replace(/\r$/, "").length, task });
		from += line.length + 1;
	}
	return out;
}

/** Why running cannot be done now, or null when it can. */
export type Block = "offline" | "busy" | "no-command" | "not-approved" | "nothing" | "sent" | null;

/** What stands in the way, the most immediate first. */
export function runBlocked(now: { online: boolean; streaming: boolean; compacting: boolean; hasCommand: boolean; spec: SpecInfo | null; count: number; sent: boolean }): Block {
	if (!now.online) return "offline";
	if (now.streaming || now.compacting) return "busy";
	if (!now.hasCommand) return "no-command";
	if (!now.spec || now.spec.approved < APPROVED_DOCS.length || !now.spec.written.includes("tasks.md")) return "not-approved";
	if (now.count === 0) return "nothing";
	if (now.sent) return "sent";
	return null;
}

const REASONS: Record<NonNullable<Block>, string> = {
	offline: "Not connected",
	busy: "The agent is working",
	"no-command": "Spec commands are not loaded here",
	"not-approved": "Approve the requirements and the design first, and have the tasks written",
	nothing: "No task here left to run",
	sent: "Starting…",
};

/** That, in words, for the line the control sits in. */
export const runWhy = (block: Block): string | null => (block === null ? null : REASONS[block]);
