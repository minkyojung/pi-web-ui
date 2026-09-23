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
	/** `[x]`: accepted by the person (spec.ts done). */
	done: boolean;
	/** `[-]`: set aside by the person, not to be run — the box Obsidian and others use for it. */
	cancelled: boolean;
}

/**
 * A task line, in the parts writing the box back needs: what comes before the
 * box, the box itself, and everything after it verbatim, so that putting a
 * line back changes the one character and no other byte.
 */
const TASK = /^(\s*- \[)([ xX-])(\] (\d+(?:\.\d+)?)\.?[ \t]+(\S.*))$/;
const TASKS = new RegExp(TASK.source, "gm");

/** The task a single line is, or null for a line that is not one — the same reading parseTasks makes of every line. */
export function taskAt(line: string): Task | null {
	const found = TASK.exec(line.replace(/\r$/, ""));
	return found ? { number: found[4]!, title: found[5]!.replace(/\s+$/, ""), done: /[xX]/.test(found[2]!), cancelled: found[2] === "-" } : null;
}

export function parseTasks(text: string): Task[] {
	return [...text.matchAll(TASKS)].map((found) => ({
		number: found[4]!,
		// The line's tail as matched carries any trailing spaces and a CR with it.
		title: found[5]!.replace(/\s+$/, ""),
		done: /[xX]/.test(found[2]!),
		cancelled: found[2] === "-",
	}));
}

/** The tasks under this one: `2.1` and `2.2` are `2`'s. */
const childrenOf = (tasks: Task[], number: string) => tasks.filter((task) => task.number.startsWith(`${number}.`));

/**
 * The task to run next: the first not done that is work of its own. One with
 * sub-tasks is only their heading — Kiro's rule is to start with the sub-tasks,
 * and there is nothing left in the parent once they are done.
 */
/**
 * Whether a task is still to be run: not done, not set aside, and not
 * waiting to be looked at — `skip` names those, the ones a run has ended in
 * a commit for that the person has not accepted (review); the list itself
 * cannot know them, git does (specResults.ts), so the caller says.
 */
const open = (task: Task, skip: ReadonlySet<string>) => !task.done && !task.cancelled && !skip.has(task.number);

export function nextTask(tasks: Task[], skip: ReadonlySet<string> = new Set()): Task | null {
	return tasks.find((task) => open(task, skip) && childrenOf(tasks, task.number).length === 0) ?? null;
}

/**
 * The task to run when the person names `number`: that one, or — a heading
 * being no work of its own — the first of its sub-tasks still to do, which is
 * Kiro's rule again. Null when the list has no such number.
 */
export function taskToRun(tasks: Task[], number: string, skip: ReadonlySet<string> = new Set()): Task | null {
	const named = tasks.find((task) => task.number === number);
	return named ? (nextTask(childrenOf(tasks, number), skip) ?? named) : null;
}

/**
 * The runs the person means by `number`, in order: the task itself when it
 * is work of its own, and for a heading every sub-task of it still to do —
 * Kiro's "Start task" on a heading, which is its sub-tasks first and all of
 * them. Empty when there is nothing left under it; null when the list has
 * no such number. Two numbers that overlap (`2` and `2.2`) mean the same
 * run once, which is the caller's to fold (runsOf).
 */
export function runsUnder(tasks: Task[], number: string, skip: ReadonlySet<string> = new Set()): Task[] | null {
	const named = tasks.find((task) => task.number === number);
	if (!named) return null;
	const children = childrenOf(tasks, number);
	// Named by the person: a task set aside or waiting to be looked at runs again if they say so; only one accepted does not.
	if (children.length === 0) return named.done ? [] : [named];
	return children.filter((child) => open(child, skip) && childrenOf(tasks, child.number).length === 0);
}

/**
 * The runs several numbers mean together, each once and in the order the
 * list stands: `2 2.2` is 2's sub-tasks, and `2.2 1` is 1 then 2.2. Null
 * names the first number the list does not have.
 */
export function runsOf(tasks: Task[], numbers: readonly string[], skip: ReadonlySet<string> = new Set()): { runs: Task[]; missing: string | null } {
	const wanted = new Set<string>();
	for (const number of numbers) {
		const under = runsUnder(tasks, number, skip);
		if (under === null) return { runs: [], missing: number };
		for (const task of under) wanted.add(task.number);
	}
	return { runs: tasks.filter((task) => wanted.has(task.number)), missing: null };
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
	/** Set aside: counted in `total`, since the box is drawn, and not in `done`. */
	cancelled: number;
	/** The number of the task nextTask would run, or null when there is none to. */
	next: string | null;
	/**
	 * In review: run, and neither accepted nor set aside — the numbers, in the
	 * plan's order. A count would do for the foot of the window; the numbers
	 * let it also say which lines of the results those are, from the one
	 * reading of the file.
	 */
	review: string[];
}

/** `skip` is the tasks that have been run (reviewedOf in spec.ts, the results in workspace.ts): not next, and in review until their box is marked. */
export function progressOf(tasks: Task[], skip: ReadonlySet<string> = new Set()): Progress {
	return {
		total: tasks.length,
		done: tasks.filter((task) => task.done).length,
		cancelled: tasks.filter((task) => task.cancelled).length,
		next: nextTask(tasks, skip)?.number ?? null,
		review: tasks.filter((task) => open(task, new Set()) && skip.has(task.number)).map((task) => task.number),
	};
}

/** `done` with every heading whose sub-tasks are all in it or set aside: the heading is done when nothing under it is left. */
export function withParents(tasks: Task[], done: Set<string>): Set<string> {
	const grown = new Set(done);
	for (const task of tasks) {
		const children = childrenOf(tasks, task.number);
		if (children.length > 0 && children.every((child) => grown.has(child.number) || child.cancelled) && children.some((child) => grown.has(child.number))) grown.add(task.number);
	}
	return grown;
}

/**
 * The text with the boxes saying exactly `done` — checked for what is in it,
 * empty for what is not. What the run's own task did not do is not recorded,
 * so a box the model checked on its way past is undone here.
 */
export function withDone(text: string, done: Set<string>): string {
	// A box set aside stays set aside: that was the person's word, not a run's.
	return text.replace(TASKS, (_line, before: string, box: string, rest: string, number: string) => `${before}${box === "-" ? "-" : done.has(number) ? "x" : " "}${rest}`);
}

/** The text with every box empty — the plan as it was approved, however far it has got or what was set aside (specApproval.ts). */
export function blankBoxes(text: string): string {
	return text.replace(TASKS, (_line, before: string, _box: string, rest: string) => `${before} ${rest}`);
}

/** The text with one task's box saying `box` and every other byte as it was — the person's own word on a task (spec.ts done, cancel). */
export function withBox(text: string, number: string, box: " " | "x" | "-"): string {
	return text.replace(TASKS, (line, before: string, _box: string, rest: string, found: string) => (found === number ? `${before}${box}${rest}` : line));
}

/**
 * The command a task's `_Done when:` line names, or null: none, or a line
 * that names no command — "what to look at" is for a person. The command is
 * what is in the line's first backticks, which is how the plan is told to
 * write one (spec.ts TASKS_RULES). Read off the task's own lines: from its
 * line down to the next task's, wherever they begin.
 */
export function doneWhenOf(text: string, number: string): string | null {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => taskAt(line)?.number === number);
	if (start === -1) return null;
	for (const line of lines.slice(start + 1)) {
		if (taskAt(line)) break;
		const found = /_Done when:\s*([^_]*)_/.exec(line);
		if (!found) continue;
		const command = /`([^`]+)`/.exec(found[1]!);
		return command ? command[1]!.trim() || null : null;
	}
	return null;
}
