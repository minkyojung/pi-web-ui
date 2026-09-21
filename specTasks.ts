/**
 * The tasks of a spec, as `tasks.md` holds them — docs/spec-mode/task-runs.md.
 *
 * The third document is a checklist, and it is both the plan and the record of
 * how far the work has got: the box is the state, read back off the file every
 * time rather than kept anywhere, the way specApproval.ts reads approval off
 * the documents themselves. Undoing a task is then undoing its box.
 *
 * What a task line is, is read off its number and nothing else. Kiro's own
 * "Start task" broke on this three times over (its issues #2476, #3810, #9405)
 * by reading the shape of the list instead: its own example writes 2.1 flush
 * with 2, models indent it or do not, and a list whose nesting is judged by
 * spaces disagrees with the numbering the same file carries. So `2.1` is under
 * `2` because of the dot, wherever the line begins, and a line without a
 * number is not a task — a sub-bullet, `_Requirements: 1.2_`, a heading.
 *
 * Read strictly on purpose. These files are written by our own agent, to the
 * form its instructions give it (spec.ts), so there is nothing to be generous
 * about; a line that misses the form is better left out of the plan than
 * guessed at, since a task guessed wrong is a commit made wrong.
 *
 * Nothing of Octave's in it, like spec.ts and specApproval.ts, so the command
 * runs in pi's terminal too.
 */

export interface Task {
	/** `2`, or `2.1` for one of its sub-tasks. */
	number: string;
	/** The objective, as the line gives it — and, when it is run, its commit's subject. */
	title: string;
	done: boolean;
}

/**
 * A task line, in the parts writing the box back needs: what comes before the
 * box, the box itself, and everything after it verbatim, so that putting a
 * line back changes the one character and no other byte.
 */
const TASK = /^(\s*- \[)([ xX])(\] (\d+(?:\.\d+)?)\.?[ \t]+(\S.*))$/;
const TASKS = new RegExp(TASK.source, "gm");

/** The task a single line is, or null for a line that is not one — the same reading parseTasks makes of every line. */
export function taskAt(line: string): Task | null {
	const found = TASK.exec(line.replace(/\r$/, ""));
	return found ? { number: found[4]!, title: found[5]!.replace(/\s+$/, ""), done: found[2] !== " " } : null;
}

export function parseTasks(text: string): Task[] {
	return [...text.matchAll(TASKS)].map((found) => ({
		number: found[4]!,
		// The line's tail as matched carries any trailing spaces and a CR with it.
		title: found[5]!.replace(/\s+$/, ""),
		done: found[2] !== " ",
	}));
}

/** The tasks under this one: `2.1` and `2.2` are `2`'s. */
const childrenOf = (tasks: Task[], number: string) => tasks.filter((task) => task.number.startsWith(`${number}.`));

/**
 * The task to run next: the first not done that is work of its own. One with
 * sub-tasks is only their heading — Kiro's rule is to start with the sub-tasks,
 * and there is nothing left in the parent once they are done.
 */
export function nextTask(tasks: Task[]): Task | null {
	return tasks.find((task) => !task.done && childrenOf(tasks, task.number).length === 0) ?? null;
}

/**
 * The task to run when the person names `number`: that one, or — a heading
 * being no work of its own — the first of its sub-tasks still to do, which is
 * Kiro's rule again. Null when the list has no such number.
 */
export function taskToRun(tasks: Task[], number: string): Task | null {
	const named = tasks.find((task) => task.number === number);
	return named ? (nextTask(childrenOf(tasks, number)) ?? named) : null;
}

/**
 * How far the list has got, as a window says it: how many boxes there are,
 * how many are checked, and which task is next.
 *
 * Every box is counted, a heading's with the rest. The count stands beside
 * the document, and the document draws a heading with sub-tasks as one more
 * line with a box — flush with them, since the reading is by number and not
 * by indent — so a count of the leaves alone says three where the eye sees
 * four, with nothing on the screen to say why. What GitHub, Obsidian and
 * Notion count is what is drawn. The heading's box is checked by the code
 * when its sub-tasks are (withParents), so the count moves with the boxes.
 * Which task runs next is another question, and that one is asked of the
 * leaves (nextTask).
 */
export interface Progress {
	total: number;
	done: number;
	/** The number of the task nextTask would run, or null when all are done. */
	next: string | null;
}

export function progressOf(tasks: Task[]): Progress {
	return { total: tasks.length, done: tasks.filter((task) => task.done).length, next: nextTask(tasks)?.number ?? null };
}

/** `done` with every heading whose sub-tasks are all in it: the heading is done when they are. */
export function withParents(tasks: Task[], done: Set<string>): Set<string> {
	const grown = new Set(done);
	for (const task of tasks) {
		const children = childrenOf(tasks, task.number);
		if (children.length > 0 && children.every((child) => grown.has(child.number))) grown.add(task.number);
	}
	return grown;
}

/**
 * The text with the boxes saying exactly `done` — checked for what is in it,
 * empty for what is not. What the run's own task did not do is not recorded,
 * so a box the model checked on its way past is undone here.
 */
export function withDone(text: string, done: Set<string>): string {
	return text.replace(TASKS, (_line, open: string, _box: string, rest: string, number: string) => `${open}${done.has(number) ? "x" : " "}${rest}`);
}
