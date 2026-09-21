/**
 * A spec's results, as the list at the foot of the window says them.
 *
 * The server gives every run of every task, oldest first (specResults.ts).
 * A list for reading wants less: one line a task, in the order the work was
 * done, the last run standing for a task run again and saying how many times;
 * and which of them the person has not looked at yet. Both are read off what
 * the server gave, here, so opening the list asks nothing of anybody.
 *
 * "Not looked at" is kept as the last commit that was — not as a count.
 * A count goes wrong the moment the history under it changes: a branch
 * switched, a commit amended. A commit that is no longer in the list means
 * nothing here has been seen, which is the safe way to be wrong.
 *
 * Pure. The stores are read where it is drawn.
 */
import type { TaskResult } from "../../specResults.ts";

/** One line of the list: a task's last run, and how many runs it has had. */
export interface ResultLine extends TaskResult {
	runs: number;
	/** Committed after the last one the person looked at. */
	fresh: boolean;
}

export interface ResultsList {
	lines: ResultLine[];
	/** Tasks with a result, which is the number of lines. */
	tasks: number;
	/** How many of them are fresh. */
	fresh: number;
	added: number;
	deleted: number;
	/** The newest commit here, which is what looking at the list has seen; null with no results. */
	newest: string | null;
}

/**
 * `results` as the server gives them, folded; `seen` is the commit the person
 * last looked up to, or null for never.
 */
export function listOf(results: readonly TaskResult[], seen: string | null): ResultsList {
	// Everything after the commit last seen is fresh — and everything, when
	// that commit is not here at all.
	const at = seen === null ? -1 : results.findIndex((result) => result.commit === seen);
	const byTask = new Map<string, ResultLine>();
	results.forEach((result, index) => {
		const had = byTask.get(result.task);
		// Deleted and set again, so a task run again takes the place of its
		// last run in the order — the list is of what was done, as it was done.
		if (had) byTask.delete(result.task);
		byTask.set(result.task, { ...result, runs: (had?.runs ?? 0) + 1, fresh: index > at });
	});
	const lines = [...byTask.values()];
	return {
		lines,
		tasks: lines.length,
		fresh: lines.filter((line) => line.fresh).length,
		added: lines.reduce((sum, line) => sum + line.added, 0),
		deleted: lines.reduce((sum, line) => sum + line.deleted, 0),
		newest: results.at(-1)?.commit ?? null,
	};
}

/** The button's words: `5 tasks`, and `2 new` beside it when there are. */
export const tasksWords = (list: Pick<ResultsList, "tasks">): string => `${list.tasks} ${list.tasks === 1 ? "task" : "tasks"}`;
export const freshWords = (list: Pick<ResultsList, "fresh">): string | null => (list.fresh > 0 ? `${list.fresh} new` : null);
