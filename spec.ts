/**
 * `/spec <a line>`: the start of a spec — docs/spec-mode.
 *
 * The line is what the person wants built. The agent names the work, makes
 * its folder under `.octave/specs/`, writes the requirements, and stops for
 * the person to read them — Kiro's first phase, in Kiro's form — and then the
 * workspace's branch is given the spec's name, on Octave's unit of a spec
 * being a branch.
 *
 * The model judges and the code acts. The name is a judgement about the
 * person's words, so the model makes it; the specs already there are facts,
 * read here and written into the instructions. The branch is git's, and git
 * renames it, here, once the turn that wrote the spec is over: asked to run
 * `git branch -m` with no shell to run it in — the mode of the day had none — a
 * model wrote `.git/HEAD` and a ref by hand, which leaves the old branch standing
 * and nothing in git's log. GitHub's Spec Kit has its script make the branch
 * for the same reason. It is renamed only while it still has a workspace's
 * placeholder name — a city, as electron/cities.js gives them — so `main`, or
 * a branch already named for its work, is never renamed by a second spec.
 *
 * Seen as Claude Code shows a command: the line as typed, as the person's
 * message, and the instructions beside it for the model only — a message
 * pi delivers with the next turn, which is this line's. Nothing waits: the
 * turn starts as the command runs.
 *
 * `/spec-approve`: the person approves the document that is waiting, when
 * they have read it and it is right, and the agent goes on to the next —
 * the design, then the tasks, in the form Kiro's prompt gives them — or, when
 * the next is there already and the person went back and changed what it
 * stands on, brings it into line. Nobody asks for the approval: Kiro's model
 * asks after every revision, and a question that comes back each time is in
 * the way of a person still working on the document. So the agent writes and
 * stops, and the code says once, when a turn leaves a document newly waiting,
 * where it is and how to approve it.
 *
 * The documents come in turn, each once the person has approved the one
 * before it (specApproval.ts), and the order is kept here rather than only
 * asked for: edit and write are refused a document whose turn has not come,
 * and the record of what was approved, which is the person's to write. The
 * instructions say so too; this is what holds when they are forgotten, as
 * the instruction to leave `.git` alone was. The shell is not looked at —
 * docs/spec-mode/approval-gates.md.
 *
 * A file of its own with nothing of Octave's in it but the name of the folder,
 * so the same command runs in pi's terminal: `pi -e spec.ts`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { writeAtomic } from "./atomic.ts";
import { APP_DIR_NAME, APPROVALS, SPEC_DOCS, type SpecDoc, SPECS_DIR } from "./documentKinds.ts";
import { CITIES } from "./electron/cities.js";
import { approve, type SpecState, specState } from "./specApproval.ts";
import { nextTask, parseTasks, runsOf, runsUnder, type Task, taskToRun, withDone, withParents } from "./specTasks.ts";

/** A workspace's placeholder name: a city, or a city of a later round (`lisbon-v2`). */
const PLACEHOLDER = new RegExp(`^(?:${CITIES.join("|")})(?:-v\\d+)?$`);

/**
 * What goes before the spec's name when this branch is renamed — its owner
 * and a slash, or nothing for a branch with no owner — or null when the
 * branch is not to be renamed: it already has a name of its own, or there is
 * no branch at all.
 */
export function unnamed(branch: string | null): string | null {
	if (!branch) return null;
	const at = branch.lastIndexOf("/");
	return PLACEHOLDER.test(branch.slice(at + 1)) ? branch.slice(0, at + 1) : null;
}

/** The names of the specs the folder already has. */
export function takenSpecs(cwd: string): string[] {
	try {
		return readdirSync(join(cwd, SPECS_DIR), { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

/**
 * The spec and the file in its folder that a tool's path names, or null for
 * any other path. Read as pi's own tools read one — an `@` before it dropped,
 * `~` the home folder, relative to the folder — and without regard to case,
 * since a Mac's disk has none: `Design.md` there is design.md.
 */
export function specFileAt(cwd: string, given: string): { name: string; file: string } | null {
	const bare = given.startsWith("@") ? given.slice(1) : given;
	const path = bare === "~" || bare.startsWith("~/") ? join(homedir(), bare.slice(1)) : bare;
	const parts = relative(cwd, resolve(cwd, path)).split(sep);
	if (parts.length !== 4 || `${parts[0]}/${parts[1]}/`.toLowerCase() !== SPECS_DIR) return null;
	return { name: parts[2]!, file: parts[3]!.toLowerCase() };
}

/**
 * Why edit or write may not change the file a path names, or null when they
 * may: the record of approvals, and a spec's document before its turn.
 */
export function refusal(cwd: string, given: string): string | null {
	const at = specFileAt(cwd, given);
	if (!at) return null;
	if (at.file === APPROVALS) return `${given} is the record of what the person approved, and only /spec-approve writes it.`;
	const turn = SPEC_DOCS.indexOf(at.file as SpecDoc);
	if (turn === -1) return null;
	const { approved, waiting } = specState(cwd, at.name);
	if (turn <= approved) return null;
	const before = SPEC_DOCS[approved]!;
	if (waiting !== before) return `${at.file} cannot be written yet: a spec's documents are written in turn (${SPEC_DOCS.join(", ")}), and ${before} is not written yet.`;
	return `${at.file} comes after ${before}, which the person has not approved as it is now, so it cannot be written yet. They approve ${before} themselves, with /spec-approve, once they have read it. Do not ask them to approve it: stop here, and change ${before} only if they ask.`;
}

/** The requirements document's form, as Kiro's spec prompt gives it. */
const FORM = `\`\`\`md
# Requirements Document

## Introduction

[Introduction text here]

## Requirements

### Requirement 1

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. WHEN [event] THEN [system] SHALL [response]
2. IF [precondition] THEN [system] SHALL [response]

### Requirement 2

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. WHEN [event] THEN [system] SHALL [response]
2. WHEN [event] AND [condition] THEN [system] SHALL [response]
\`\`\``;

/**
 * What the model is told, beside the line. `prefix` is unnamed()'s answer
 * for `branch`, and `taken` the specs already there.
 */
export function specPrompt({ line, prefix, branch, taken }: { line: string; prefix: string | null; branch: string | null; taken: string[] }): string {
	const steps = [
		`Name it: a short kebab-case name for the feature, from their words (e.g. "user-authentication")${taken.length ? `, and not one of these, which are taken: ${taken.join(", ")}` : ""}.`,
		`Make the folder ${SPECS_DIR}{name}/.`,
		[
			`Write ${SPECS_DIR}{name}/requirements.md with write — it is not a note, so not note_write. Write it now, from their words, without asking questions first, in the language they wrote in (WHEN, IF, THEN and SHALL stay as they are, where the form puts them), in this form:`,
			"",
			FORM,
			"",
			"Consider edge cases, user experience, technical constraints and success criteria. Do not explore the code for this: these are requirements, and the design comes after them.",
		].join("\n"),
		"Then stop. Say in a line or two what you wrote and where, point out what needs their decision, and ask them to read it and change what is not right. Do not ask them to approve it: they approve it themselves, with a command, once they have read it. Do not go on to a design or to code.",
	];
	return [
		`The person started a spec with /spec: "${line}"`,
		"",
		"Write the first document of a spec for it, its requirements, and stop. In order:",
		...steps.map((step, i) => `${i + 1}. ${step}`),
		...(prefix !== null
			? ["", "Do not rename the branch or write anything under .git: once you have written the requirements, the branch is named after the spec for you."]
			: branch
				? ["", `Leave the branch as it is (${branch}): it already has a name, and a spec is written on the branch it is on. Do not write anything under .git.`]
				: []),
		"",
		"Do not narrate these steps; do them.",
	].join("\n");
}

/** The design document's form: the sections Kiro's spec prompt asks for, under the heading its documents have. */
const DESIGN_FORM = `\`\`\`md
# Design Document

## Overview

## Architecture

## Components and Interfaces

## Data Models

## Error Handling

## Testing Strategy
\`\`\``;

/** What Kiro's spec prompt tells its model the tasks are, word for word. */
const TASKS_CHARGE =
	"Convert the feature design into a series of prompts for a code-generation LLM that will implement each step in a test-driven manner. Prioritize best practices, incremental progress, and early testing, ensuring no big jumps in complexity at any stage. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.";

/** The tasks document's form: Kiro's example, cut short where it cuts it. */
const TASKS_FORM = `\`\`\`md
# Implementation Plan

- [ ] 1. Set up project structure and core interfaces
  - Create directory structure for models, services, repositories, and API components
  - Define interfaces that establish system boundaries
  - _Requirements: 1.1_

- [ ] 2. Implement data models and validation
- [ ] 2.1 Create core data model interfaces and types
  - Write TypeScript interfaces for all data models
  - Implement validation functions for data integrity
  - _Requirements: 2.1, 3.3, 1.2_

- [ ] 2.2 Implement User model with validation
  - Write User class with validation methods
  - Create unit tests for User model validation
  - _Requirements: 1.2_

[Additional coding tasks continue...]
\`\`\``;

/** How every document's turn ends: stopped, told, and not asked. */
const stop = (said: string, onward: string) =>
	`Then stop. Say in a line or two what you ${said}, and point out what needs their decision. Do not ask them to approve it: they approve it themselves, with a command, once they have read it. ${onward}`;

/**
 * What the model is told once the person has approved the spec `name` up to
 * the document before `next`: to write `next`, or — `redo`, when it is there
 * already, written on documents the person has since gone back and changed —
 * to bring it into line with them.
 */
export function nextPrompt({ name, next, redo }: { name: string; next: "design.md" | "tasks.md"; redo: boolean }): string {
	const dir = `${SPECS_DIR}${name}/`;
	const steps =
		next === "design.md"
			? redo
				? [
						`The person went back and changed the spec "${name}", and has approved its requirements again as they are now: ${dir}requirements.md. Its design, ${dir}design.md, was written on them as they were before.`,
						"",
						"Bring the design into line, and stop. In order:",
						"1. Read the requirements and the design, and find where the design no longer fits them.",
						"2. Change the design there, and only there, with edit, in its form and its language. If nothing needs to change, change nothing.",
						"3. If the requirements now miss something or contradict themselves, do not change them: say what, and offer to go back to them.",
						`4. ${stop("changed, or that nothing needed to change", "Do not go on to the tasks or to code.")}`,
					]
				: [
						`The person approved the requirements of the spec "${name}": ${dir}requirements.md.`,
						"",
						"Write its design, and stop. In order:",
						"1. Read the requirements. Then find out what the design needs: read the code it will touch, and look up what you do not know. Say briefly in your reply what you found that shapes the design; do not write it to a file of its own.",
						[
							`2. Write ${dir}design.md with write — it is not a note, so not note_write — in the language the requirements are written in, in this form:`,
							"",
							DESIGN_FORM,
							"",
							"Address every requirement. Draw a diagram in Mermaid where one helps. Say what you decided, and why.",
						].join("\n"),
						"3. If writing it shows that the requirements miss something or are wrong, do not change them: say what, and offer to go back to them.",
						`4. ${stop("wrote", "Do not go on to the tasks or to code.")}`,
					]
			: redo
				? [
						`The person went back and changed the spec "${name}", and has approved it again as it is now: ${dir}requirements.md and ${dir}design.md. Its tasks, ${dir}tasks.md, were written on them as they were before.`,
						"",
						"Bring the tasks into line, and stop. In order:",
						"1. Read the requirements, the design and the tasks, and find where the tasks no longer fit them.",
						"2. Change the tasks there, and only there, with edit: add, change or remove tasks, keeping their form, their numbering and the requirements they are for right. A task checked as done stays as it is; if what it built has to change, add a task for that. If nothing needs to change, change nothing.",
						"3. If the design or the requirements now miss something, do not change them: say what, and offer to go back.",
						`4. ${stop("changed, or that nothing needed to change", "Do not start on the tasks.")}`,
					]
				: [
						`The person approved the design of the spec "${name}": ${dir}design.md, on ${dir}requirements.md.`,
						"",
						"Write its tasks, and stop. In order:",
						"1. Read the requirements and the design.",
						[
							`2. Write ${dir}tasks.md with write — it is not a note, so not note_write — in the language they are written in. ${TASKS_CHARGE}`,
							"Make it a numbered checkbox list at most two levels deep, sub-tasks numbered 1.1, 1.2, 2.1, in this form:",
							"",
							TASKS_FORM,
							"",
							'Each task has a clear objective that is writing, modifying or testing code; what it involves, as sub-bullets; and the requirements it is for, by the numbers of their acceptance criteria ("_Requirements: 1.2, 3.3_"). Every requirement is covered by some task, and each task builds on the ones before it. Leave out what a coding agent cannot do: user testing, deployment, gathering metrics, running the app by hand to check it (an automated test that does is a task), documentation, and anything else that is not writing, modifying or testing code.',
						].join("\n"),
						"3. If writing them shows that the design or the requirements miss something, do not change them: say what, and offer to go back.",
						`4. ${stop("wrote", "Do not start on the tasks.")}`,
					];
	return [...steps, "", "Do not narrate these steps; do them."].join("\n");
}

// ---- Running a task ----

/** The hidden message a task's run is told by, and marked as, in its session. */
const TASK_MARK = "spec-task";

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

/** pi's thinking levels, as words a person may put after /spec-run. */
const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * What the session being opened for a run should be set to, handed from the
 * instance that opens it to the one made for it. The opening instance cannot
 * set anything on the session: its pi is stale the moment the session is
 * replaced, and the context it is handed has no setter. The new instance
 * hears session_start before anything else happens in its session, and its
 * own pi is the one that can — so the wish is left here, by folder, for it.
 */
const wanted = new Map<string, { model: string | null; effort: string | null }>();

/**
 * What the model is told at the start of a task's run — Kiro's task
 * instructions, which are the whole of its execution rule: read all three
 * documents, do the one task, check it against the criteria it names, stop.
 * Ours on the end are the two things the code does instead of it.
 */
export function taskPrompt({ spec, task, title }: TaskMark): string {
	const dir = `${SPECS_DIR}${spec}/`;
	const steps = [
		`Read all three of ${dir}requirements.md, ${dir}design.md and ${dir}tasks.md before you change anything. A task done without the requirements or the design is done wrong.`,
		`Do task ${task} of ${dir}tasks.md — "${title}" — and only it. Do not build any part of another task, even one you can see it will need.`,
		"Check what you built against the acceptance criteria the task names (_Requirements: 1.2, 3.3_), by their numbers in the requirements.",
		"Then stop. Say in a line or two what you did and anything the person should look at, and end with one line beginning `Checks:` — the checks you ran and what they said (`Checks: npm test — 923 passed`), or `Checks: none` if you ran none. That line goes into the task's commit. Do not go on to the next task.",
	];
	return [
		`The person asked for task ${task} of the spec "${spec}" to be run with /spec-run.`,
		"",
		"In order:",
		...steps.map((step, i) => `${i + 1}. ${step}`),
		"",
		`Leave ${dir}tasks.md alone: the task is checked off for you when this turn ends, and changing the plan is something to go back to the person about. Do not commit and do not touch the branch or anything under .git — the commit for this task is made for you too.`,
		"",
		"Do not narrate these steps; do them.",
	].join("\n");
}

/** As much of a session's entry as the mark is read out of. */
interface SessionEntry {
	type?: string;
	customType?: string;
	details?: unknown;
}

/** Somewhere to say something to the person: the part of a context this uses. */
interface Speaking {
	cwd: string;
	ui: { notify: (message: string, type?: "info" | "warning" | "error") => void };
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
	for (let at = entries.length - 1; at >= 0; at--) {
		const entry = entries[at] as SessionEntry | null;
		if (!entry || entry.type !== "custom_message" || entry.customType !== TASK_MARK) continue;
		const details = entry.details as Partial<TaskMark> | undefined;
		if (!details || typeof details.spec !== "string" || typeof details.task !== "string" || typeof details.title !== "string" || !Array.isArray(details.done)) return null;
		const numbers = (given: unknown) => (Array.isArray(given) ? given.filter((number): number is string => typeof number === "string") : []);
		const word = (given: unknown) => (typeof given === "string" ? given : null);
		return { spec: details.spec, task: details.task, title: details.title, done: numbers(details.done), then: numbers(details.then), model: word(details.model), effort: word(details.effort) };
	}
	return null;
}

/**
 * The `Checks:` line of the run's last answer, or null when it ended without
 * one — the result is a commit either way; the line is what the commit says
 * about how the work was checked (task-runs.md "결과는 커밋에"). The last
 * text the assistant wrote is looked at — only that one, since the report is
 * the end of the run and an earlier turn's line is another task's — and in
 * it the last line that begins with the word, so a model that quoted the
 * instruction before answering is not taken at its quote.
 */
export function checksIn(entries: readonly unknown[]): string | null {
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
		// An answer that is only a tool call has no text and is not the report;
		// the last one with words is, and it either has the line or does not.
		if (text.trim() === "") continue;
		const said = text
			.split("\n")
			.map((line) => line.trim())
			.reverse()
			.find((line) => /^checks:/i.test(line));
		if (said === undefined) return null;
		const rest = said.slice("checks:".length).trim();
		return rest || null;
	}
	return null;
}

/**
 * Whether this is a repository at all, and what is waiting to be committed in
 * it that is the person's — neither the spec's documents nor the app's folder.
 *
 * The documents are not a task's work: they were written before it and only
 * ride into its commit, so they neither stand in the way of a run starting nor
 * stand for one having done something. `.pi/` is not the person's at all —
 * Octave writes it into every folder it opens, and its own `.gitignore` is
 * left untracked there, so counting it would mean no task could ever start.
 *
 * Every untracked file is asked for by name: git collapses an untracked folder
 * to the folder, and `.octave/` on its own cannot be told apart from work
 * outside it.
 */
async function waitingToCommit(pi: ExtensionAPI, cwd: string): Promise<{ repository: boolean; work: string[] }> {
	const status = await pi.exec("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd, timeout: 30_000 }).catch(() => null);
	if (!status || status.code !== 0) return { repository: false, work: [] };
	const work = status.stdout
		.split("\0")
		.filter(Boolean)
		.map((entry) => entry.slice(3))
		.filter((path) => !path.startsWith(SPECS_DIR) && !path.startsWith(`${APP_DIR_NAME}/`));
	return { repository: true, work };
}

/**
 * The end of a task's run: one commit for what it changed, and its box in
 * tasks.md checked — both here rather than by the model. Not because the model
 * could not: on Plan it has no shell at all, and on Execution it has one, and a
 * task that is committed or not depending on the rung the person happens to be
 * on is not a unit of anything. A box and a commit that disagreed could not be
 * told apart afterwards either. Which boxes are
 * checked is written from what was done when the run began and the one task it
 * was for, so a box the model checked on its way past is not a task done.
 *
 * A run that changed nothing leaves nothing — no commit and no box, and the
 * same task is next again.
 */
export async function finishTask(pi: ExtensionAPI, { cwd, ui }: Speaking, mark: TaskMark, checks: string | null = null): Promise<void> {
	ended.set(endedKey(cwd, mark), await finish(pi, { cwd, ui }, mark, checks));
}

/**
 * What the commit says under its subject: git's trailers, in the place it
 * keeps `Co-authored-by:`. The spec and the task, so a log can be read by
 * spec; and the checks, in the run's own words, so that what was done to
 * confirm the work is in the commit that is the work — in the clone and on
 * the PR, read with `git log` and nothing else (task-runs.md "결과는 커밋에").
 */
export function trailersOf({ spec, task }: Pick<TaskMark, "spec" | "task">, checks: string | null): string {
	return [`Spec: ${spec}`, `Task: ${task}`, `Checks: ${checks ?? "none"}`].join("\n");
}

/**
 * How a task's run ended, for the queue it may be part of (runNext). Kept in
 * the module rather than the extension instance: the run's end is heard by
 * the instance made for its session, and the chain that started it runs on
 * the one before — both are this module, loaded once.
 */
type Ended = "committed" | "checked" | "nothing" | "uncommitted";
const ended = new Map<string, Ended>();
const endedKey = (cwd: string, { spec, task }: TaskMark) => `${cwd}\0${spec}\0${task}`;

async function finish(pi: ExtensionAPI, { cwd, ui }: Speaking, mark: TaskMark, checks: string | null): Promise<Ended> {
	const git = (args: string[]) => pi.exec("git", args, { cwd, timeout: 30_000 });
	const where = `${SPECS_DIR}${mark.spec}/tasks.md`;
	const file = join(cwd, where);
	const { repository, work } = await waitingToCommit(pi, cwd);
	// A run that touched nothing outside the spec's folder did nothing, however
	// much is waiting there: the documents were written before it.
	if (repository && work.length === 0) {
		ui.notify(`${mark.task} changed nothing, so it is not checked off and there is no commit.`, "warning");
		return "nothing";
	}
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		ui.notify(`${where} is not there, so ${mark.task} could not be checked off.`, "warning");
		return "nothing";
	}
	writeAtomic(file, withDone(text, withParents(parseTasks(text), new Set([...mark.done, mark.task]))));
	if (!repository) {
		ui.notify(`${mark.task} is done. There is no repository here, so nothing was committed.`, "warning");
		return "checked";
	}
	// Everything the run left but the app's own folder, which belongs to no
	// commit of the person's.
	const added = await git(["add", "-A", "--", ".", `:(exclude)${APP_DIR_NAME}`]);
	const made = added.code === 0 ? await git(["commit", "-m", mark.title, "-m", trailersOf(mark, checks)]) : added;
	if (made.code !== 0) {
		ui.notify(`${mark.task} is done, but git could not commit it: ${(made.stderr || made.stdout).trim()}`, "warning");
		return "uncommitted";
	}
	const at = await git(["rev-parse", "--short", "HEAD"]);
	const next = nextTask(parseTasks(readFileSync(file, "utf8")));
	const going = mark.then[0];
	ui.notify(`${mark.task} is done${at.code === 0 ? `, in commit ${at.stdout.trim()}` : ""}. ${going ? `${going} starts next.` : next ? `Next is ${next.number} — /spec-run` : "That was the last task."}`, "info");
	return "committed";
}

/**
 * A session is opened for `mark`'s task, told what it is, and sent the line
 * the person typed; when its turn ends and the task is checked off, the next
 * of `mark.then` is started the same way, in a session of its own.
 *
 * The chain lives on the context the new session hands back and nowhere
 * else. An event's context cannot open a session — only a command's can —
 * and the command's own is stale the moment the first session is replaced;
 * the one `withSession` gives is a command's for the session it made, and pi
 * resolves sendUserMessage only when that session's turn has ended and every
 * extension has heard agent_settled, which is when the box and the commit
 * are made (finishTask). So what is read afterwards is the file: the next
 * task starts only when this one's box is checked, and a run that changed
 * nothing, or could not be committed, stops the queue where it is rather
 * than stepping past what it did not do.
 *
 * Started, not waited for: pi's sendUserMessage runs the turn to its end
 * before it resolves, and newSession does not return until withSession
 * does — so waiting here would hold the host on the session it just left for
 * the whole run, and the person would watch nothing happen until the commit
 * landed.
 */
async function startRun(ctx: Pick<ExtensionCommandContext, "newSession">, cwd: string, mark: TaskMark): Promise<void> {
	if (mark.model || mark.effort) wanted.set(cwd, { model: mark.model, effort: mark.effort });
	await ctx.newSession({
		withSession: async (session) => {
			await session.sendMessage({ customType: TASK_MARK, content: taskPrompt(mark), display: false, details: mark }, { deliverAs: "nextTurn" });
			void session
				.sendUserMessage(`/spec-run ${mark.task}`)
				.then(() => runNext(session, cwd, mark))
				.catch((error: unknown) => {
					session.ui.notify(`The run of ${mark.task} stopped: ${error instanceof Error ? error.message : String(error)}`, "error");
				});
		},
	});
}

/** The session a run was opened in, as much of it as the chain uses: pi's ReplacedSessionContext, which the package does not export. */
type RunSession = Speaking & Pick<ExtensionCommandContext, "newSession">;

/**
 * After `mark`'s turn: the next task of its queue, if its own was committed.
 *
 * Nothing here is asked of git or of the pi this was started from: that pi
 * is the instance made for the session before, and is stale once the
 * session was replaced. What the run left is read instead — how it ended,
 * from the module, and the list, from the file. A committed run leaves the
 * folder clean, which is what starting the next needs.
 */
async function runNext(session: RunSession, cwd: string, mark: TaskMark): Promise<void> {
	const [number, ...rest] = mark.then;
	if (!number) return;
	const left = [number, ...rest].join(", ");
	const not = `${left} ${rest.length > 0 ? "were" : "was"} not started`;
	const how = ended.get(endedKey(cwd, mark)) ?? "nothing";
	ended.delete(endedKey(cwd, mark));
	if (how === "nothing" || how === "uncommitted") {
		session.ui.notify(`${mark.task} was not ${how === "nothing" ? "checked off" : "committed"}, so ${not}.`, "warning");
		return;
	}
	let tasks: Task[];
	try {
		tasks = parseTasks(readFileSync(join(cwd, SPECS_DIR, mark.spec, "tasks.md"), "utf8"));
	} catch {
		session.ui.notify(`${SPECS_DIR}${mark.spec}/tasks.md is not there, so ${not}.`, "warning");
		return;
	}
	const task = taskToRun(tasks, number);
	if (!task || task.done) {
		session.ui.notify(`${mark.spec} has no task ${number} left to run, so ${not}.`, "warning");
		return;
	}
	await startRun(session, cwd, { spec: mark.spec, task: task.number, title: task.title, done: tasks.filter((other) => other.done).map((other) => other.number), then: rest, model: mark.model, effort: mark.effort });
}

/**
 * Whether the folder holds changes of the person's, said to them if so. A
 * task's commit takes the whole folder, so the folder must hold nothing else
 * of the person's when a run starts.
 */
async function dirty(pi: ExtensionAPI, ctx: Speaking, cwd: string, orElse: string): Promise<boolean> {
	const { work } = await waitingToCommit(pi, cwd);
	if (work.length === 0) return false;
	const some = work.slice(0, 3).join(", ");
	ctx.ui.notify(`Commit or put back what has changed first — a task's commit takes the whole folder: ${some}${work.length > 3 ? `, and ${work.length - 3} more` : ""}. ${orElse}.`, "warning");
	return true;
}

/** What each spec in the folder is waiting on, by name. */
function waitingIn(cwd: string): Map<string, SpecDoc | null> {
	return new Map(takenSpecs(cwd).map((name) => [name, specState(cwd, name).waiting]));
}

/** The documents waiting for the person, with their specs' names. */
function waitingNow(cwd: string): [string, SpecDoc][] {
	return [...waitingIn(cwd)].filter((entry): entry is [string, SpecDoc] => entry[1] !== null);
}

/** How the person approves a spec's document: with its name when there is more than one to choose between. */
const approveWith = (name: string, waiting: unknown[]) => (waiting.length > 1 ? `/spec-approve ${name}` : "/spec-approve");

/**
 * What the model is told beside the person's message while a document waits
 * for them, or null when none does. Said as of that message, since it stays
 * in the conversation with it.
 */
export function waitingNote(cwd: string): string | null {
	const waiting = waitingNow(cwd);
	if (waiting.length === 0) return null;
	return waiting
		.map(([name, doc]) => {
			const how = approveWith(name, waiting);
			return `When they sent this message, ${SPECS_DIR}${name}/${doc} was waiting for the person to approve it, which they do themselves with ${how}. Until they do, the documents after it cannot be written: if they ask for one, say that ${doc} is to be approved first, with ${how}, and do not try to write it. Changing ${doc}, or a document before it, when they ask is fine.`;
		})
		.join("\n");
}

/**
 * Give the checked-out branch the spec's name, as git would: `-2`, `-3` and on
 * when a branch of that name is already there. The name it has now, or null
 * when git would not give it one.
 */
async function rename(pi: ExtensionAPI, cwd: string, prefix: string, name: string): Promise<string | null> {
	const git = (args: string[]) => pi.exec("git", args, { cwd, timeout: 5000 });
	try {
		for (let n = 1; n <= 20; n++) {
			const target = `${prefix}${n === 1 ? name : `${name}-${n}`}`;
			if ((await git(["show-ref", "--verify", "--quiet", `refs/heads/${target}`])).code === 0) continue;
			return (await git(["branch", "-m", target])).code === 0 ? target : null;
		}
	} catch {
		// git could not be run at all: the same answer, said the same way.
	}
	return null;
}

/** The branch the folder has checked out, or null: detached, or not a repository. */
async function branchIn(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	try {
		const { code, stdout } = await pi.exec("git", ["branch", "--show-current"], { cwd, timeout: 5000 });
		return code === 0 ? stdout.trim() || null : null;
	} catch {
		return null;
	}
}

export default function spec(pi: ExtensionAPI): void {
	/** The specs there were when /spec ran, until its run is over: one made since is the one it wrote. */
	let before: Set<string> | null = null;
	/** What each spec was waiting on when the run started, until it is over. */
	let waitedAtStart: Map<string, SpecDoc | null> | null = null;
	/** The spec /spec-approve went on with, until its run is over. */
	let approving: string | null = null;
	/** Whether this session's task has been finished: a session runs one. */
	let ranTask = false;

	pi.registerCommand("spec", {
		description: "Start a spec from a line: the agent names it and writes its requirements for you to read",
		handler: async (args, ctx) => {
			const line = args.trim();
			if (!line) {
				ctx.ui.notify("Say what to build after /spec, in a line — /spec add sign-in with email", "info");
				return;
			}
			// A line sent now would wait behind the run in progress, and its
			// instructions would go with whatever turn came first.
			if (!ctx.isIdle()) {
				ctx.ui.notify("The agent is working. Start the spec when it has finished.", "warning");
				return;
			}
			const branch = await branchIn(pi, ctx.cwd);
			const taken = takenSpecs(ctx.cwd);
			before = new Set(taken);
			// Queued first: "nextTurn" goes with the next message sent, which is the line below.
			pi.sendMessage({ customType: "spec", content: specPrompt({ line, prefix: unnamed(branch), branch, taken }), display: false }, { deliverAs: "nextTurn" });
			pi.sendUserMessage(`/spec ${line}`);
		},
	});

	pi.registerCommand("spec-approve", {
		description: "Approve the spec document waiting for you; the agent goes on to the next one",
		handler: async (args, ctx) => {
			// What the agent is writing now may be the document itself.
			if (!ctx.isIdle()) {
				ctx.ui.notify("The agent is working. Approve when it has finished.", "warning");
				return;
			}
			const given = args.trim();
			const specs = takenSpecs(ctx.cwd).map((name) => ({ name, ...specState(ctx.cwd, name) }));
			// Somewhere to go on to: a document waiting, or one approved and the
			// next not written — its turn was stopped before it wrote it.
			const open = (spec: SpecState) => spec.waiting !== null || (spec.approved > 0 && spec.approved < SPEC_DOCS.length);
			const candidates = given ? specs.filter((spec) => spec.name === given) : specs.filter(open);
			const chosen = candidates[0];
			if (!chosen) {
				ctx.ui.notify(given ? `There is no spec called ${given}.` : "Nothing is waiting for your approval. A spec starts with /spec and a line of what to build.", "info");
				return;
			}
			if (candidates.length > 1) {
				ctx.ui.notify(`More than one spec is waiting: ${candidates.map((spec) => spec.name).join(", ")}. Say which: /spec-approve ${chosen.name}`, "info");
				return;
			}
			const ready = `The spec ${chosen.name} is ready: its requirements, design and tasks are approved.`;
			const idle = `Nothing of ${chosen.name} is waiting for your approval.`;
			if (!open(chosen)) {
				ctx.ui.notify(chosen.approved === SPEC_DOCS.length ? ready : idle, "info");
				return;
			}
			// Where the next document is: after the one approved now, or after the
			// ones approved before — never the requirements, which come from /spec.
			let at = chosen.approved;
			if (chosen.waiting) {
				const approved = approve(ctx.cwd, chosen.name);
				if (!approved) {
					ctx.ui.notify(idle, "info");
					return;
				}
				at = SPEC_DOCS.indexOf(approved) + 1;
				if (at === SPEC_DOCS.length) {
					ctx.ui.notify(ready, "info");
					return;
				}
			}
			const next = SPEC_DOCS[at] as "design.md" | "tasks.md";
			const redo = existsSync(join(ctx.cwd, SPECS_DIR, chosen.name, next));
			approving = chosen.name;
			pi.sendMessage({ customType: "spec", content: nextPrompt({ name: chosen.name, next, redo }), display: false }, { deliverAs: "nextTurn" });
			pi.sendUserMessage(given ? `/spec-approve ${given}` : "/spec-approve");
		},
	});

	pi.registerCommand("spec-run", {
		description: "Run the next task of a spec you have approved: a session of its own, one task, one commit",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("The agent is working. Run the task when it has finished.", "warning");
				return;
			}
			// The words that are numbers are the tasks, in the order given; one
			// with a slash is a model, `provider/id`; one of pi's levels is the
			// effort; any other word names the spec.
			const words = args.trim().split(/\s+/).filter(Boolean);
			const numbers = [...new Set(words.filter((word) => /^\d+(?:\.\d+)?$/.test(word)))];
			const model = words.find((word) => word.includes("/")) ?? null;
			const effort = words.find((word) => EFFORTS.includes(word)) ?? null;
			const given = words.find((word) => !numbers.includes(word) && word !== model && word !== effort) ?? null;
			if (model) {
				const [provider, ...id] = model.split("/");
				if (!ctx.modelRegistry.find(provider ?? "", id.join("/"))) {
					ctx.ui.notify(`There is no model called ${model}. A model is named as the picker keys it: provider/id.`, "info");
					return;
				}
			}
			const specs = takenSpecs(ctx.cwd).map((name) => ({ name, ...specState(ctx.cwd, name) }));
			const ready = (spec: SpecState) => spec.approved === SPEC_DOCS.length;
			const run = specs.filter(ready);
			// The ready ones when there are any, and otherwise all of them, so
			// that the one spec there is says what it is waiting for rather than
			// going unfound.
			const candidates = given ? specs.filter((spec) => spec.name === given) : run.length > 0 ? run : specs;
			const chosen = candidates[0];
			if (!chosen) {
				const none = "No spec is ready to run. A spec starts with /spec and a line of what to build, and its tasks are run once you have approved all three of its documents.";
				ctx.ui.notify(given ? `There is no spec called ${given}.` : none, "info");
				return;
			}
			if (candidates.length > 1) {
				ctx.ui.notify(`More than one spec: ${candidates.map((spec) => spec.name).join(", ")}. Say which: /spec-run ${chosen.name}${numbers.length > 0 ? ` ${numbers.join(" ")}` : ""}`, "info");
				return;
			}
			if (!ready(chosen)) {
				ctx.ui.notify(
					chosen.waiting
						? `${SPECS_DIR}${chosen.name}/${chosen.waiting} is waiting for you: read it, and approve it with ${approveWith(chosen.name, waitingNow(ctx.cwd))} before its tasks can be run.`
						: `${chosen.name} has no tasks to run yet: its ${SPEC_DOCS[chosen.approved]} is still to be written.`,
					"info",
				);
				return;
			}
			const text = readFileSync(join(ctx.cwd, SPECS_DIR, chosen.name, "tasks.md"), "utf8");
			const tasks = parseTasks(text);
			// Every number named is looked at before any is started: a queue with
			// a task that is not there, or is done, is a question to go back with,
			// not a run to stop halfway. A heading is its sub-tasks still to do,
			// all of them in order — Kiro's Start on a heading — and numbers that
			// overlap mean each run once, in the order the list stands: a task
			// builds on the ones before it (runsOf).
			const { runs, missing } = runsOf(tasks, numbers);
			if (missing !== null) {
				ctx.ui.notify(`${chosen.name} has no task ${missing}.`, "info");
				return;
			}
			const finished = numbers.find((number) => runsUnder(tasks, number)?.length === 0);
			if (finished !== undefined) {
				ctx.ui.notify(`${finished} is already done. To have it done again, clear its box in ${SPECS_DIR}${chosen.name}/tasks.md first.`, "info");
				return;
			}
			const queue = numbers.length > 0 ? runs : [nextTask(tasks)].filter((task): task is Task => task !== null);
			const [task, ...then] = queue;
			if (!task) {
				ctx.ui.notify(`Every task of ${chosen.name} is done.`, "info");
				return;
			}
			if (await dirty(pi, ctx, ctx.cwd, "Nothing was started")) return;
			// A session of its own, as Kiro runs a task: the three documents are
			// all it needs, and a dozen tasks in one conversation would not fit.
			// The mark rides on the instructions, which is how the end of the turn
			// knows what this session was — see taskMark. The rest of the queue
			// rides with it, and is started task by task as each is checked off.
			await startRun(ctx, ctx.cwd, {
				spec: chosen.name,
				task: task.number,
				title: task.title,
				done: tasks.filter((other) => other.done).map((other) => other.number),
				then: then.map((other) => other.number),
				model,
				effort,
			});
		},
	});

	// A document before its turn, or the record of approvals: refused before
	// the tool runs, with the reason for the model to read.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
		const path: unknown = event.input.path;
		const reason = typeof path === "string" ? refusal(ctx.cwd, path) : null;
		return reason ? { block: true, reason } : undefined;
	});

	// While a document waits, the model is told so beside the person's message,
	// as guard.ts tells it which note is open: a message of its own rather than
	// a line of the system prompt, which comes before the whole conversation and
	// would throw away the provider's cache of it whenever this changed. Told,
	// the model answers "go on" with how to approve, rather than writing the
	// next document whole and only then being refused.
	pi.on("before_agent_start", async (_event, ctx) => {
		const note = waitingNote(ctx.cwd);
		return note ? { message: { customType: "spec-waiting", content: note, display: false } } : undefined;
	});

	// Kept from the run's first start to its end: a retry starts it again, and
	// what it wrote before that is still this run's.
	pi.on("agent_start", async (_event, ctx) => {
		waitedAtStart ??= waitingIn(ctx.cwd);
	});

	// Once the run is over — retries and all; pi tells anyone else only after
	// this — the spec /spec wrote names the branch, and a document the run left
	// waiting is said, once.
	// A session opened for a run: on the model and at the effort the run was
	// asked for, before its first turn. Only a wish left for this folder by
	// startRun, and taken so that the session after this one opens as usual.
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "new") return;
		const wish = wanted.get(ctx.cwd);
		if (!wish) return;
		wanted.delete(ctx.cwd);
		if (wish.model) {
			const [provider, ...id] = wish.model.split("/");
			const model = ctx.modelRegistry.find(provider ?? "", id.join("/"));
			if (!model || !(await pi.setModel(model))) ctx.ui.notify(`${wish.model} could not be used for this run — it stays on ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "the model it opened on"}.`, "warning");
		}
		if (wish.effort) pi.setThinkingLevel(wish.effort as Parameters<typeof pi.setThinkingLevel>[0]);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		// A session opened by /spec-run is the run of one task, and this is the
		// end of it: the box and the commit. Later turns in it are conversation.
		const mark = ranTask ? null : taskMark(ctx.sessionManager.buildContextEntries());
		if (mark) {
			ranTask = true;
			waitedAtStart = null;
			await finishTask(pi, ctx, mark, checksIn(ctx.sessionManager.buildContextEntries()));
			return;
		}
		await nameBranch(ctx);
		const had = waitedAtStart ?? new Map<string, SpecDoc | null>();
		const asked = approving;
		waitedAtStart = null;
		approving = null;
		const waiting = waitingNow(ctx.cwd);
		for (const [name, doc] of waiting) {
			// Revised at the person's word, it is the same document waiting: said
			// once is enough. After /spec-approve it is said whatever waited before —
			// the design brought into line waits as it did, and that is the news.
			if (name !== asked && had.get(name) === doc) continue;
			ctx.ui.notify(`${SPECS_DIR}${name}/${doc} is waiting for you: read it, and when it is right, approve it with ${approveWith(name, waiting)}.`, "info");
		}
	});

	/**
	 * The spec /spec's run wrote names the branch, if the branch is still a
	 * placeholder. Written with write or from the shell alike: what is looked at
	 * is the folder.
	 */
	async function nameBranch({ cwd, ui }: ExtensionContext): Promise<void> {
		if (!before) return;
		const had = before;
		before = null;
		const made = takenSpecs(cwd).filter((name) => !had.has(name) && existsSync(join(cwd, SPECS_DIR, name, "requirements.md")));
		// None written, or more than one to choose between: nothing to go on.
		if (made.length !== 1) return;
		const branch = await branchIn(pi, cwd);
		const prefix = unnamed(branch);
		if (prefix === null) return;
		const now = await rename(pi, cwd, prefix, made[0]!);
		if (now) ui.notify(`The branch is ${now} now.`, "info");
		else ui.notify(`The branch could not be named after ${made[0]}; it is still ${branch}.`, "warning");
	}
}
