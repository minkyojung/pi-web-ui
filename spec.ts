/**
 * `/spec <a line>`: the start of a spec — docs/spec-mode.
 *
 * The line is what the person wants built. The agent names the work, makes
 * its folder under `.octave/specs/`, gives the workspace's branch that name,
 * writes the requirements, and stops for the person to read them — Kiro's
 * first phase, in Kiro's form, on Octave's unit of a spec being a branch.
 *
 * What the command knows it says, and what it cannot know it asks for. The
 * branch and the specs already there are facts, read here and written into
 * the instructions; the name is a judgement about the person's words, and the
 * model makes it. The branch is renamed only while it still has a workspace's
 * placeholder name — a city, as electron/cities.js gives them — so `main`, or
 * a branch already named for its work, is never renamed by a second spec.
 *
 * Seen as Claude Code shows a command: the line as typed, as the person's
 * message, and the instructions beside it for the model only — a message
 * pi delivers with the next turn, which is this line's. Nothing waits: the
 * turn starts as the command runs.
 *
 * A file of its own with nothing of Octave's in it but the name of the folder,
 * so the same command runs in pi's terminal: `pi -e spec.ts`.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { SPECS_DIR } from "./documentKinds.ts";
import { CITIES } from "./electron/cities.js";

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
		...(prefix === null
			? []
			: [
					`Rename this workspace's branch, which has had a placeholder name until now, to the spec's: \`git branch -m ${prefix}{name}\`. If git says that branch exists, add -2 (then -3, and on) to the name, the folder's too, and try again.`,
				]),
		[
			`Write ${SPECS_DIR}{name}/requirements.md with write — it is not a note, so not note_write. Write it now, from their words, without asking questions first, in the language they wrote in (WHEN, IF, THEN and SHALL stay as they are), in this form:`,
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
		...(branch && prefix === null ? ["", `Leave the branch as it is (${branch}): it already has a name, and a spec is written on the branch it is on.`] : []),
		"",
		"Do not narrate these steps; do them.",
	].join("\n");
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
			// Queued first: "nextTurn" goes with the next message sent, which is the line below.
			pi.sendMessage(
				{ customType: "spec", content: specPrompt({ line, prefix: unnamed(branch), branch, taken: takenSpecs(ctx.cwd) }), display: false },
				{ deliverAs: "nextTurn" },
			);
			pi.sendUserMessage(`/spec ${line}`);
		},
	});
}
