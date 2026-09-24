/**
 * `/create-pr`: the agent commits what is left, pushes, and opens a pull
 * request against the base — what the Create PR button at the foot of the
 * window sends, and what can be typed in pi's own terminal too.
 *
 * Conductor's button, as it is: the conversation says "Create a PR", and
 * beside it, hidden, the steps — made at the moment it is pressed from what
 * git says then (standingIn), so a step is there only when there is
 * something for it to do: a commit where files are not committed, a push
 * where origin lacks commits or the branch. Its words are Conductor's, read
 * off the instructions it sent on this machine, with two changes: `--draft`
 * for Create draft PR, and `-u` on the first push, so the branch has an
 * upstream after it and what a push would send is counted against it.
 *
 * Refused while the agent is working, as /setup is: steps sent now would go
 * with whatever turn came first.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { standingIn } from "./standing.ts";

export interface PullRequestAsk {
	changes: number;
	branch: string;
	/** The base, as `main`. */
	base: string;
	/** Whether origin has this branch. */
	published: boolean;
	/** Commits origin's branch does not have; 0 when it has none of this name. */
	unpushed: number;
	draft: boolean;
}

/** The hidden steps, from the state of the folder at the moment of asking. Pure. */
export function pullRequestPrompt(ask: PullRequestAsk): string {
	const steps: string[] = [];
	if (ask.changes > 0) steps.push("- Run `git diff` to review the uncommitted changes.", "- Commit them. Follow any instructions the user gave you about writing commit messages.");
	if (ask.changes > 0 || !ask.published || ask.unpushed > 0) steps.push(ask.published ? "- Push to origin." : `- Push to origin with \`git push -u origin ${ask.branch}\`.`);
	steps.push(`- Use \`git diff origin/${ask.base}...\` to review the PR diff.`);
	steps.push(`- Use \`gh pr create --base ${ask.base}${ask.draft ? " --draft" : ""}\` to create a ${ask.draft ? "draft " : ""}PR onto the target branch. Keep the title under 80 characters and the description under five sentences (unless the user has given you other instructions).`);
	const upstream = !ask.published ? "There is no upstream branch yet." : ask.unpushed > 0 ? `An upstream branch exists, and ${ask.unpushed} ${ask.unpushed === 1 ? "commit is" : "commits are"} not on it yet.` : "An upstream branch exists.";
	return [
		"The user likes the state of the code.",
		"",
		`There ${ask.changes === 1 ? "is 1 uncommitted change" : `are ${ask.changes} uncommitted changes`}.`,
		`The current branch is ${ask.branch}.`,
		`The target branch is origin/${ask.base}.`,
		upstream,
		"",
		`The user requested a ${ask.draft ? "draft " : ""}PR.`,
		"",
		"Follow these **exact steps** to create it:",
		"",
		...steps,
		"",
		"If any of these steps fail, ask the user for help.",
	].join("\n");
}

/** The name the window looks for on pi's list of commands, and sends. */
export const CREATE_PR = "create-pr";

export default function pullRequest(pi: ExtensionAPI): void {
	pi.registerCommand(CREATE_PR, {
		description: "Have the agent commit what is left, push, and open a pull request against the base — `/create-pr draft` for a draft",
		handler: async (args, ctx) => {
			const draft = args.trim() === "draft";
			if (!ctx.isIdle()) {
				ctx.ui.notify("The agent is working. Ask for the pull request when it has finished.", "warning");
				return;
			}
			const git = await standingIn(ctx.cwd);
			if (!git?.base) {
				ctx.ui.notify("There is no origin here to open a pull request on.", "warning");
				return;
			}
			if (git.branch === git.base) {
				ctx.ui.notify(`This is ${git.base} itself: a pull request is from a branch of its own.`, "warning");
				return;
			}
			if (git.changes === 0 && !git.ahead) {
				ctx.ui.notify(`Nothing here that ${git.base} does not have.`, "info");
				return;
			}
			const content = pullRequestPrompt({ changes: git.changes, branch: git.branch, base: git.base, published: git.remote !== null, unpushed: git.remote?.ahead ?? 0, draft });
			// Queued first: "nextTurn" goes with the next message sent, which is the line below.
			pi.sendMessage({ customType: CREATE_PR, content, display: false }, { deliverAs: "nextTurn" });
			pi.sendUserMessage(draft ? "Create a draft PR" : "Create a PR");
		},
	});
}
