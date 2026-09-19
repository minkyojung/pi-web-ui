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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { SPECS_DIR } from "./documentKinds.ts";
import { CITIES } from "./electron/cities.js";
import { APPROVALS, SPEC_DOCS, type SpecDoc, specState } from "./specApproval.ts";

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
		"Then stop. Say in a line or two what you wrote and where, point out what needs their decision, and ask them to read it and change what is not right. Do not go on to a design or to code.",
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

	// A document before its turn, or the record of approvals: refused before
	// the tool runs, with the reason for the model to read.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
		const path: unknown = event.input.path;
		const reason = typeof path === "string" ? refusal(ctx.cwd, path) : null;
		return reason ? { block: true, reason } : undefined;
	});

	// Once the run is over — retries and all; pi tells anyone else only after
	// this — the spec it wrote names the branch, if the branch is still a
	// placeholder. Written with write or from the shell alike: what is looked
	// at is the folder.
	pi.on("agent_settled", async (_event, ctx) => {
		if (!before) return;
		const had = before;
		before = null;
		const made = takenSpecs(ctx.cwd).filter((name) => !had.has(name) && existsSync(join(ctx.cwd, SPECS_DIR, name, "requirements.md")));
		// None written, or more than one to choose between: nothing to go on.
		if (made.length !== 1) return;
		const branch = await branchIn(pi, ctx.cwd);
		const prefix = unnamed(branch);
		if (prefix === null) return;
		const now = await rename(pi, ctx.cwd, prefix, made[0]!);
		if (now) ctx.ui.notify(`The branch is ${now} now.`, "info");
		else ctx.ui.notify(`The branch could not be named after ${made[0]}; it is still ${branch}.`, "warning");
	});
}
