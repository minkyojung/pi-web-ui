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
 * `git branch -m` with no shell — Octave's Coding mode has none — a model
 * wrote `.git/HEAD` and a ref by hand, which leaves the old branch standing
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
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { SPECS_DIR } from "./documentKinds.ts";
import { CITIES } from "./electron/cities.js";
import { APPROVALS, approve, SPEC_DOCS, type SpecDoc, type SpecState, specState } from "./specApproval.ts";

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

/** What each spec in the folder is waiting on, by name. */
function waitingIn(cwd: string): Map<string, SpecDoc | null> {
	return new Map(takenSpecs(cwd).map((name) => [name, specState(cwd, name).waiting]));
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

	// A document before its turn, or the record of approvals: refused before
	// the tool runs, with the reason for the model to read.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
		const path: unknown = event.input.path;
		const reason = typeof path === "string" ? refusal(ctx.cwd, path) : null;
		return reason ? { block: true, reason } : undefined;
	});

	// Kept from the run's first start to its end: a retry starts it again, and
	// what it wrote before that is still this run's.
	pi.on("agent_start", async (_event, ctx) => {
		waitedAtStart ??= waitingIn(ctx.cwd);
	});

	// Once the run is over — retries and all; pi tells anyone else only after
	// this — the spec /spec wrote names the branch, and a document the run left
	// waiting is said, once.
	pi.on("agent_settled", async (_event, ctx) => {
		await nameBranch(ctx);
		const had = waitedAtStart ?? new Map<string, SpecDoc | null>();
		const asked = approving;
		waitedAtStart = null;
		approving = null;
		const waiting = [...waitingIn(ctx.cwd)].filter((entry): entry is [string, SpecDoc] => entry[1] !== null);
		for (const [name, doc] of waiting) {
			// Revised at the person's word, it is the same document waiting: said
			// once is enough. After /spec-approve it is said whatever waited before —
			// the design brought into line waits as it did, and that is the news.
			if (name !== asked && had.get(name) === doc) continue;
			const how = waiting.length > 1 ? `/spec-approve ${name}` : "/spec-approve";
			ctx.ui.notify(`${SPECS_DIR}${name}/${doc} is waiting for you: read it, and when it is right, approve it with ${how}.`, "info");
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
