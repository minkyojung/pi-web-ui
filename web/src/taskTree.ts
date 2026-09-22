/**
 * A spec's tasks.md as the window draws it when it is being read: not the
 * markdown, but what the markdown is a plan of.
 *
 * The document is written by our own agent to a form the app gave it
 * (spec.ts TASKS_FORM) and read back by number (specTasks.ts), so the app
 * already knows what every line of it is — which task, under which, done or
 * not, and beneath each task the two lines that are read by name and the
 * bullets that are not. Drawn as a tree with what each task came to beside
 * it, it is the plan and its progress on one page; drawn as markdown it was
 * the plan, and the progress was a list at the foot of the window.
 *
 * What is here is the reading. Which task ended in which commit, and how, is
 * the results' (resultsList.ts); which is running is the session's
 * (ConfigMsg.run); which is next is specTasks' own answer. This joins none of
 * them — the view does, where the stores are — it only says what the text
 * holds and what a task's standing is given those answers, so both can be
 * pinned without a browser.
 *
 * Read as strictly as specTasks.ts reads, and for the same reason: a line
 * that misses the form is shown as a line and not guessed into a task.
 */
import { type Task, taskAt } from "../../specTasks.ts";

export interface TaskRow extends Task {
	kind: "task";
	/** The line the task is on, 1-based as the editor counts, for what is drawn over it. */
	line: number;
	/** The lines of its two keys, when they are there — drawn in their own way. */
	requirementsLine: number | null;
	doneWhenLine: number | null;
	/** 0 for `2`, 1 for `2.1`: how many dots the number has. */
	depth: number;
	/** The sub-tasks' numbers, in the order they stand; empty for a task that is work of its own. */
	children: string[];
	/** The bullets under the line that are neither key: what the task involves. */
	involves: string[];
	/** `_Requirements: 1.2, 3.3_`, as numbers; empty when the line is not there. */
	requirements: string[];
	/** `_Done when: …_`, whole; null when the line is not there. The command in it is doneWhenOf's (specTasks.ts). */
	doneWhen: string | null;
}

/** A line between tasks that is not one and not a task's bullet — a heading over a group of them, or a sentence. Its text, marks off. */
export interface SectionRow {
	kind: "section";
	line: number;
	text: string;
}

export type Row = TaskRow | SectionRow;

export interface Tree {
	/** Everything before the first task — the title and what the plan is for — as written, for a markdown renderer. */
	head: string;
	rows: Row[];
	/** The tasks alone, in order: what specTasks' questions are asked of. */
	tasks: Task[];
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const REQUIREMENTS = /^_Requirements:\s*([^_]*)_\s*$/;
const DONE_WHEN = /^_Done when:\s*([^_]*)_\s*$/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;

export function treeOf(text: string): Tree {
	const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
	// One reading of what a task line is — specTasks' — asked of every line,
	// as parseTasks asks it; the tree is the same lines, kept apart.
	const tasks = lines.map(taskAt).filter((task): task is Task => task !== null);
	const rows: Row[] = [];
	const head: string[] = [];
	let current: TaskRow | null = null;
	lines.forEach((line, index) => {
		const number = index + 1;
		const task = taskAt(line);
		if (task) {
			current = {
				kind: "task",
				line: number,
				requirementsLine: null,
				doneWhenLine: null,
				...task,
				depth: task.number.split(".").length - 1,
				children: tasks.filter((other) => other.number.startsWith(`${task.number}.`)).map((other) => other.number),
				involves: [],
				requirements: [],
				doneWhen: null,
			};
			rows.push(current);
			return;
		}
		// Before the first task the document is its own: the title, a line on
		// what the plan is for. Kept whole, blank lines and all, since it is
		// drawn as markdown.
		if (rows.length === 0) {
			head.push(line);
			return;
		}
		if (line.trim() === "") return;
		const bullet = BULLET.exec(line);
		// A box with no number is a task the form missed, not a bullet of the
		// task above: shown as a line of its own, where it can be seen and fixed.
		const boxed = bullet !== null && /^\[[ xX]\]\s/.test(bullet[1]!);
		if (bullet && current && !boxed) {
			const item = bullet[1]!.trim();
			const requirements = REQUIREMENTS.exec(item);
			const doneWhen = DONE_WHEN.exec(item);
			if (requirements) {
				current.requirements = requirements[1]!.split(",").map((s) => s.trim()).filter((s) => s !== "");
				current.requirementsLine = number;
			} else if (doneWhen) {
				current.doneWhen = doneWhen[1]!.trim();
				current.doneWhenLine = number;
			} else current.involves.push(item);
			return;
		}
		// A wrapped bullet: the line goes on under the one before it.
		if (/^\s/.test(line) && current && current.involves.length > 0 && !bullet) {
			current.involves[current.involves.length - 1] += ` ${line.trim()}`;
			return;
		}
		const heading = HEADING.exec(line);
		rows.push({ kind: "section", line: number, text: heading ? heading[1]! : boxed ? bullet![1]!.replace(/^\[[ xX]\]\s+/, "") : line.trim() });
		// A section closes the task before it: a bullet after a heading is the heading's, not the task's.
		current = null;
	});
	return { head: head.join("\n").trim(), rows, tasks };
}

/**
 * Where a task stands, in one word, for the mark at the start of its row.
 *
 * Running outranks everything: a heading is running while one of its
 * sub-tasks is, since that is what running the heading means (Kiro's Start on
 * a heading). Done is the box, which the run's end checks (spec.ts). Next is
 * specTasks' nextTask — the first leaf not done — and is only ever a leaf;
 * a heading's progress is its sub-tasks' and is said as a count instead.
 */
export type Standing = "running" | "done" | "next" | "todo";

export function standingOf(task: Pick<Task, "number" | "done">, at: { running: string | null; next: string | null }): Standing {
	if (at.running !== null && (at.running === task.number || at.running.startsWith(`${task.number}.`))) return "running";
	if (task.done) return "done";
	if (at.next === task.number) return "next";
	return "todo";
}

/** How many of a heading's sub-tasks are done, over how many there are — by the boxes, as the count at the start of the row has it. */
export function progressUnder(tasks: readonly Task[], number: string): { done: number; total: number } {
	const under = tasks.filter((task) => task.number.startsWith(`${number}.`));
	return { done: under.filter((task) => task.done).length, total: under.length };
}
