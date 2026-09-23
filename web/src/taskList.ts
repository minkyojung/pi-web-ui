/**
 * A spec's tasks as the list draws them: what the markdown holds (taskTree.ts)
 * joined with what git and the session know — which task each run ended in
 * a commit for, and which is running now — into rows with a standing each,
 * under the headings the plan has, or under the standings when asked.
 *
 * Pure, so a list can be pinned without a browser: the stores are read
 * where the rows are drawn (TaskList.tsx). Nothing here is written anywhere;
 * what the person does to a task is a command the box types for them
 * (spec.ts /spec-done and the two beside it), as the approvals are.
 */
import type { TaskResult } from "../../specResults.ts";
import { nextTask } from "../../specTasks.ts";
import type { ClientMsg } from "../../protocol.ts";
import { progressUnder, type Standing, standingOf, type TaskRow, treeOf } from "./taskTree.ts";

export interface ListRow extends TaskRow {
	standing: Standing;
	/** The tasks it waits on that are not settled — by its `_After:_` line. */
	waits: string[];
	/** The newest run of it that ended in a commit, and how many did. */
	latest: TaskResult | null;
	tries: number;
	/** A heading's sub-tasks done, over how many there are to do; null for a task of its own. */
	count: { done: number; total: number } | null;
}

export interface Section {
	/** The `##` heading the tasks are under, or null for the ones before any. */
	title: string | null;
	rows: ListRow[];
	/** Of the tasks that are work of their own: done, over how many are to do (set-aside ones in neither). */
	done: number;
	total: number;
}

export interface List {
	/** Everything before the first task, as written. */
	head: string;
	sections: Section[];
	counts: Record<Standing, number>;
	/** Whether any task has run, or is: before that a dependency is nothing to draw. */
	started: boolean;
}

const STANDINGS: Standing[] = ["running", "review", "next", "todo", "done", "cancelled"];

export function listOf(text: string, { results, running }: { results: readonly TaskResult[]; running: string | null }): List {
	const tree = treeOf(text);
	// A heading right before the first task is the first section's, not the
	// head's: the tree keeps everything before the first task whole, as it is
	// drawn as markdown there, and here it is a group's title.
	const headLines = tree.head.split("\n");
	const first = /^#{2,6}\s+(.*\S)\s*$/.exec(headLines.at(-1) ?? "");
	const head = (first ? headLines.slice(0, -1) : headLines).join("\n").trim();
	const settled = (number: string) => tree.tasks.find((task) => task.number === number)?.done ?? false;
	// Git's word: a task a run ended in a commit for. The person's `x` outranks it (standingOf).
	const reviewed = new Set(results.map((result) => result.task));
	// The one running is not the next one either.
	const next = nextTask(tree.tasks, new Set([...reviewed, ...(running ? [running] : [])]))?.number ?? null;
	const sections: Section[] = [];
	let current: Section = { title: first ? first[1]! : null, rows: [], done: 0, total: 0 };
	const counts = Object.fromEntries(STANDINGS.map((s) => [s, 0])) as Record<Standing, number>;
	for (const row of tree.rows) {
		if (row.kind === "section") {
			if (current.rows.length > 0 || current.title !== null) sections.push(current);
			current = { title: row.text, rows: [], done: 0, total: 0 };
			continue;
		}
		const ran = results.filter((result) => result.task === row.number).sort((a, b) => b.at - a.at);
		const standing = standingOf(row, { running, next, reviewed });
		const parent = row.children.length > 0;
		const listed: ListRow = {
			...row,
			standing,
			waits: row.after.filter((number) => !settled(number)),
			latest: ran[0] ?? null,
			tries: ran.length,
			count: parent ? progressUnder(tree.tasks, row.number) : null,
		};
		current.rows.push(listed);
		if (!parent) {
			counts[standing]++;
			if (standing !== "cancelled") current.total++;
			if (standing === "done") current.done++;
		}
	}
	if (current.rows.length > 0 || current.title !== null) sections.push(current);
	return { head, sections, counts, started: results.length > 0 || running !== null };
}

/** The groups a list falls into by standing, in the order a person works: what is running, what waits on them, what is to do, what is done, what was set aside. */
export const GROUPS: { title: string; of: Standing[] }[] = [
	{ title: "In progress", of: ["running"] },
	{ title: "In Review", of: ["review"] },
	{ title: "To do", of: ["next", "todo"] },
	{ title: "Done", of: ["done"] },
	{ title: "Set aside", of: ["cancelled"] },
];

/** The same rows under their standings rather than their headings — headings' own rows left out, since a heading is not in any one standing. Empty groups are not drawn. */
export function byStatus(list: List): Section[] {
	const rows = list.sections.flatMap((section) => section.rows).filter((row) => row.count === null);
	return GROUPS.map((group) => {
		const mine = rows.filter((row) => group.of.includes(row.standing));
		return { title: group.title, rows: mine, done: mine.filter((row) => row.standing === "done").length, total: mine.filter((row) => row.standing !== "cancelled").length };
	}).filter((section) => section.rows.length > 0);
}

/** What the person can say of a task from its row, each the command the box types for them (spec.ts). */
export type Word = "done" | "cancel" | "reopen";

export const wordCommand = (word: Word, spec: string, number: string): string => `/spec-${word} ${spec} ${number}`;

export const wordMessage = (word: Word, spec: string, number: string): ClientMsg => ({ type: "prompt", text: wordCommand(word, spec, number), command: true, behavior: "followUp" });

/** The words a task in this standing can be given: accepted only from review, set aside from anything not done or running, opened again from done or set aside. */
export function wordsFor(standing: Standing): Word[] {
	switch (standing) {
		case "review": return ["done", "cancel"];
		case "todo":
		case "next": return ["cancel"];
		case "done":
		case "cancelled": return ["reopen"];
		case "running": return [];
	}
}
