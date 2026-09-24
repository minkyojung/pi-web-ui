/**
 * One task, to be looked at: what its run said and what it changed — the two
 * halves the person reads before accepting it, and the same two after.
 *
 * Before it is accepted the run is a session and its changes are the folder
 * (specRuns.ts, commitRead.ts readWorking): the report is the session's last
 * answer, so a change asked for in that session is answered here too. Once
 * accepted the run is a commit (spec.ts), and the report is its body, the
 * changes its files. One reading for both, so a tab on a task stays the tab
 * as the task is accepted. A task never run, or run on another branch, is
 * null.
 */
import { type CommitFile, readCommit, readWorking } from "./commitRead.ts";
import { taskResults } from "./specResults.ts";
import { reportIn, runSessions } from "./specRuns.ts";

export interface TaskRead {
	spec: string;
	task: string;
	/** The task's line, which is its commit's subject. */
	title: string;
	/** Waiting to be looked at — the changes in the folder — or accepted, in its commit. */
	standing: "review" | "done";
	/** What the run said: its last answer less the `Checks:` line, or the commit's body. */
	report: string | null;
	/** What the run said it checked, in its own words; null for none. */
	checks: string | null;
	/** What the app ran when the task was accepted, and how each ended; empty before that. */
	verified: { name: string; exit: number }[];
	commit: { hash: string; short: string; at: number } | null;
	/** The session the run was, or null for a commit that does not say. */
	session: string | null;
	files: CommitFile[];
	truncated: boolean;
}

export async function readTask(root: string, spec: string, task: string, sessionDir?: string): Promise<TaskRead | null> {
	const [sessions, results] = await Promise.all([runSessions(root, sessionDir), taskResults(root)]);
	// Sessions come newest first: the newest run is the task's.
	const run = sessions.find((one) => one.mark.spec === spec && one.mark.task === task) ?? null;
	const done = (results.get(spec) ?? []).filter((result) => result.task === task);
	const accepted = run ? (done.find((result) => result.session === run.id) ?? null) : null;
	if (run && !accepted) {
		const working = await readWorking(root);
		const { body, checks } = reportIn(run.entries);
		// `Checks: none` is the run saying it ran nothing, as the commit's trailer says it (specResults.ts).
		return { spec, task, title: run.mark.title, standing: "review", report: body, checks: checks && checks.toLowerCase() !== "none" ? checks : null, verified: [], commit: null, session: run.id, files: working?.files ?? [], truncated: working?.truncated ?? false };
	}
	const latest = accepted ?? done.at(-1) ?? null;
	if (!latest) return null;
	const read = await readCommit(root, latest.commit);
	if (!read) return null;
	return {
		spec,
		task,
		title: read.title,
		standing: "done",
		report: read.body,
		checks: read.checks,
		verified: latest.verified,
		commit: { hash: read.commit, short: read.short, at: read.at },
		session: latest.session,
		files: read.files,
		truncated: read.truncated,
	};
}
