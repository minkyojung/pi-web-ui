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
import type { SpecInfo } from "../../protocol.ts";
import type { TaskResult } from "../../specResults.ts";
import type { Progress } from "../../specTasks.ts";

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

/**
 * The button's words: the one thing about the tasks that changes what the
 * person does next, and no more. A task running — `2.1 running` — is the
 * whole of it. Else what waits on them — `1 in review · 3 to do`, the review
 * in the text's own colour (`strong`) while any of it is not yet looked at.
 * Else how far along — `2 of 5 done`, or `5 done` at the end. Set aside is
 * not here: it changes nothing anybody does, and is in the list's head.
 *
 * `progress` is the server's reading of tasks.md (Progress); null with no
 * tasks.md, when all there is to say is how many results there are.
 */
export function footWords(progress: Progress | null, { fresh, running }: { fresh: number; running: string | null }, list: Pick<ResultsList, "tasks">): { text: string; strong: string | null } {
	if (running !== null) return { text: `${running} running`, strong: null };
	if (!progress) return { text: `${list.tasks} ${list.tasks === 1 ? "task" : "tasks"}`, strong: null };
	const left = progress.total - progress.cancelled;
	if (progress.review.length > 0) {
		const head = `${progress.review.length} in review`;
		const todo = left - progress.done - progress.review.length;
		return { text: todo > 0 ? `${head} · ${todo} to do` : head, strong: fresh > 0 ? head : null };
	}
	return { text: progress.done === left ? `${progress.done} done` : `${progress.done} of ${left} done`, strong: null };
}

/** The list's head: everything counted, set aside with the rest — `1 done · 1 in review · 1 set aside · 3 to do`. */
export function headWords(progress: Progress, running: string | null): string {
	const review = progress.review.length;
	const todo = progress.total - progress.done - progress.cancelled - review - (running === null ? 0 : 1);
	const parts = [`${progress.done} done`, running !== null && "1 running", review > 0 && `${review} in review`, progress.cancelled > 0 && `${progress.cancelled} set aside`, `${todo} to do`];
	return parts.filter((part): part is string => typeof part === "string").join(" · ");
}

/**
 * How a result was checked, as one mark: what the app ran outranks what the
 * run said. `passed` and `failed` are the app's own checks — the repository's
 * and the task's `_Done when:` (Verified trailer) — `said` is the agent's
 * word that it checked something, `none` that nobody did. The one rule for
 * the list at the foot of the window and for the row in the plan, so the two
 * cannot mark one task two ways.
 */
export type CheckMark = "passed" | "failed" | "said" | "none";

export function checkMark(result: Pick<TaskResult, "checks" | "verified">): CheckMark {
	if (result.verified.length > 0) return result.verified.every((v) => v.exit === 0) ? "passed" : "failed";
	return result.checks !== null ? "said" : "none";
}

/**
 * The task a commit is the result of, among the results the window already
 * has — by the hash whole or short, as an address may give either — or null
 * for a commit that is no task's: somebody's own, or one on another branch.
 */
export function taskOfCommit(specs: readonly SpecInfo[] | null, commit: string): { spec: string; task: string; title: string; short: string } | null {
	for (const spec of specs ?? []) {
		const found = spec.results.find((result) => result.commit.startsWith(commit));
		if (found) return { spec: spec.name, task: found.task, title: found.title, short: found.short };
	}
	return null;
}

/** What a commit's tab is called: the task and its line, which is a name a person reads; a hash is not. */
export const commitTabTitle = (of: { task: string; title: string }): string => `Task ${of.task} · ${of.title}`;

/** What a task's tab is called: its line, from the run in review or the last result the window has of it; its number alone until it has either. */
export function taskTabTitle(specs: readonly SpecInfo[] | null, name: string, task: string): string {
	const spec = specs?.find((entry) => entry.name === name);
	const title = spec?.review.find((run) => run.task === task)?.title ?? spec?.results.findLast((result) => result.task === task)?.title ?? null;
	return title ? commitTabTitle({ task, title }) : `Task ${task}`;
}
