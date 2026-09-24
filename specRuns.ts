/**
 * A spec's tasks as they have been run, read off the sessions on disk.
 *
 * A task's run is a session of its own (spec.ts /spec-run), and the session
 * carries the mark of what it ran: a hidden message with the spec, the task
 * and the queue after it. So which tasks have run is a reading of the
 * sessions, as which are accepted is a reading of the commits
 * (specResults.ts): a run's commit names its session in a `Session:`
 * trailer, and a run whose session no commit names is waiting to be looked
 * at — in review. Nothing about it is kept anywhere else; a run from the
 * terminal (`pi -e spec.ts`) is seen the same way.
 *
 * The mark and its reading live here, where both the extension and the
 * server read them from, and the extension re-exports them.
 */
import { readFileSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/** The hidden message a task's run is told by, and marked as, in its session. */
export const TASK_MARK = "spec-task";

/** What a task's run is, carried in the session it runs in. */
export interface TaskMark {
	spec: string;
	/** Its number in tasks.md — `2`, or `2.1`. */
	task: string;
	/** Its objective, which is its commit's subject. */
	title: string;
	/** The tasks already done when the run began. */
	done: string[];
	/**
	 * The tasks to run after this one, in order — the rest of a `/spec-run 1
	 * 2.1 2.2`. Each is started when the one before it is checked off, in a
	 * session of its own like this one; empty for a run of one task.
	 */
	then: string[];
	/**
	 * The model to run it on, as `provider/id`, and its thinking level — or
	 * null for whatever the session opens on. A spec is written by a strong
	 * model and its tasks can be run by a cheaper one (spec-mode.md 3절 5);
	 * the choice is made once, when the run is asked for, and carries down
	 * the queue.
	 */
	model: string | null;
	effort: string | null;
}

/** As much of a session's entry as the mark is read out of. */
interface SessionEntry {
	type?: string;
	customType?: string;
	details?: unknown;
}

/**
 * The task this session is a run of, read back out of the session, or null for
 * a session that is not one.
 *
 * Not remembered in a variable here: newSession makes the extension over —
 * the command runs in one of it and the end of the turn in the next, and what
 * the first wrote down is not there for the second. So it travels in the
 * session the command opened, on the message that carries the instructions,
 * which is also where it still is after a restart.
 */
export function taskMark(entries: readonly unknown[]): TaskMark | null {
	return taskMarkEntry(entries)?.mark ?? null;
}

/**
 * The same, with the entry's own id: what a host that watches the session
 * from outside tells one run from the next by, since the mark stays in the
 * session after its turn and the turns after it are conversation.
 */
export function taskMarkEntry(entries: readonly unknown[]): { id: string; mark: TaskMark } | null {
	for (let at = entries.length - 1; at >= 0; at--) {
		const entry = entries[at] as (SessionEntry & { id?: string }) | null;
		if (!entry || entry.type !== "custom_message" || entry.customType !== TASK_MARK) continue;
		const details = entry.details as Partial<TaskMark> | undefined;
		if (!details || typeof details.spec !== "string" || typeof details.task !== "string" || typeof details.title !== "string" || !Array.isArray(details.done)) return null;
		const numbers = (given: unknown) => (Array.isArray(given) ? given.filter((number): number is string => typeof number === "string") : []);
		const word = (given: unknown) => (typeof given === "string" ? given : null);
		return {
			id: typeof entry.id === "string" ? entry.id : "",
			mark: { spec: details.spec, task: details.task, title: details.title, done: numbers(details.done), then: numbers(details.then), model: word(details.model), effort: word(details.effort) },
		};
	}
	return null;
}


/**
 * What the run said at its end: the last text the assistant wrote, as the
 * report that goes into the task's commit — the body, and its `Checks:` line.
 *
 * The body is the answer less that line: what the diff cannot say, written
 * for the person reading the commit (taskPrompt) — in the clone and on the
 * PR, with `git log` and nothing else. The line is what the commit says
 * about how the work was checked, and is a trailer of its own. Only the last
 * text is looked at, since the report is the end of the run and an earlier
 * turn's is another task's; and in it the last line that begins with the
 * word, so a model that quoted the instruction before answering is not
 * taken at its quote.
 */
export interface Report {
	/** The answer without its `Checks:` line, or null when there was nothing else in it. */
	body: string | null;
	/** What followed `Checks:`, or null when the answer had no such line. */
	checks: string | null;
}

export function reportIn(entries: readonly unknown[]): Report {
	const text = lastAnswer(entries);
	if (text === null) return { body: null, checks: null };
	const lines = text.split("\n");
	let at = lines.length - 1;
	while (at >= 0 && !/^checks:/i.test(lines[at]!.trim())) at--;
	const checks = at >= 0 ? lines[at]!.trim().slice("checks:".length).trim() || null : null;
	const body = (at >= 0 ? [...lines.slice(0, at), ...lines.slice(at + 1)] : lines).join("\n").trim();
	return { body: body || null, checks };
}

/**
 * The last text the assistant wrote, or null. An answer that is only a tool
 * call has no text and is not the report; the last one with words is.
 */
function lastAnswer(entries: readonly unknown[]): string | null {
	for (let at = entries.length - 1; at >= 0; at--) {
		const entry = entries[at] as { type?: string; message?: { role?: string; content?: unknown } } | null;
		if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
		const content = entry.message.content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.map((part) => (part && typeof part === "object" && (part as { type?: string }).type === "text" ? ((part as { text?: string }).text ?? "") : ""))
							.join("\n")
					: "";
		if (text.trim() !== "") return text;
	}
	return null;
}

/** One run of a task: the session it was, and what the mark said. */
export interface TaskRun {
	spec: string;
	task: string;
	title: string;
	/** The tasks queued after it when it was started. */
	then: string[];
	/** The session's id, which the commit accepting it carries as `Session:`. */
	session: string;
	/** When the session was last written to, in milliseconds. */
	at: number;
}

/**
 * Every session of `cwd` that is a task's run, newest first, with what it
 * holds: the mark, and the entries the report is read out of. Most sessions
 * are not a task's, and the file says so before it is opened as one.
 * `sessionDir` is pi's: the default is where pi keeps them for `cwd`.
 */
export async function runSessions(cwd: string, sessionDir?: string): Promise<{ id: string; path: string; at: number; mark: TaskMark; entries: unknown[] }[]> {
	let infos: { id: string; path: string; modified: Date }[];
	try {
		infos = await SessionManager.list(cwd, sessionDir);
	} catch {
		return [];
	}
	const runs: { id: string; path: string; at: number; mark: TaskMark; entries: unknown[] }[] = [];
	for (const info of infos.sort((a, b) => b.modified.getTime() - a.modified.getTime())) {
		try {
			if (!readFileSync(info.path, "utf8").includes(`"${TASK_MARK}"`)) continue;
			const entries = SessionManager.open(info.path, sessionDir).buildContextEntries();
			const mark = taskMark(entries);
			if (mark) runs.push({ id: info.id, path: info.path, at: info.modified.getTime(), mark, entries });
		} catch {
			// A session that cannot be read has nothing to say here.
		}
	}
	return runs;
}

/** The runs of every task, oldest first — the order the work was done in. */
export async function taskRuns(cwd: string, sessionDir?: string): Promise<TaskRun[]> {
	return (await runSessions(cwd, sessionDir)).reverse().map(({ id, at, mark }) => ({ spec: mark.spec, task: mark.task, title: mark.title, then: mark.then, session: id, at }));
}

/**
 * The runs waiting to be looked at: for each task its newest run, when no
 * commit names that run's session — `accepted` is the sessions the commits
 * name. A task run again after it was accepted is in review again; one
 * accepted and then opened again is not, since its run was accepted, and
 * is to do. Oldest first, like `runs`.
 */
export function inReview(runs: readonly TaskRun[], accepted: ReadonlySet<string>): TaskRun[] {
	const newest = new Map<string, TaskRun>();
	for (const run of runs) newest.set(`${run.spec}\0${run.task}`, run);
	return [...newest.values()].filter((run) => !accepted.has(run.session)).sort((a, b) => a.at - b.at);
}
