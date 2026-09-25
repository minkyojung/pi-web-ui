/**
 * The pull request's commands: what the buttons at the foot of the window
 * send, and what can be typed in pi's own terminal too. `/create-pr` opens
 * one; once it is open, `/push` sends what is here, and `/resolve-conflicts`,
 * `/fix-checks` and `/address-review` have the agent deal with what stands
 * in the way of the merge.
 *
 * Conductor's buttons, as they are: the conversation says what was asked —
 * "Create a PR", "Fix the failing checks" — and beside it, hidden, the steps,
 * made at the moment it is pressed from what git says then (standingIn), so
 * a step is there only when there is something for it to do: a commit where
 * files are not committed, a push where origin lacks commits or the branch.
 * Create PR's words are Conductor's, read off the instructions it sent on
 * this machine, with two changes: `--draft` for Create draft PR, and `-u` on
 * the first push, so the branch has an upstream after it and what a push
 * would send is counted against it. The rest are written the same way.
 *
 * Why a check failed, what a reviewer asked, where the conflicts are: none
 * of it is carried here. The agent reads it where it is, with gh, as a
 * person would — the window only says which of these there is to do.
 *
 * Refused while the agent is working, as /setup is: steps sent now would go
 * with whatever turn came first.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { standingIn } from "./standing.ts";

/** What the steps are made from: git's word on the folder at the moment of asking. */
export interface Here {
	changes: number;
	branch: string;
	/** The base, as `main`. */
	base: string;
	/** Whether origin has this branch. */
	published: boolean;
	/** Commits origin's branch does not have; 0 when it has none of this name. */
	unpushed: number;
	/** Commits the base does not have. */
	ahead: number;
}

export interface PullRequestAsk extends Here {
	draft: boolean;
}

/** Where the folder stands, in the lines every set of steps opens with. */
function standing(here: Here): string[] {
	const upstream = !here.published ? "There is no upstream branch yet." : here.unpushed > 0 ? `An upstream branch exists, and ${here.unpushed} ${here.unpushed === 1 ? "commit is" : "commits are"} not on it yet.` : "An upstream branch exists.";
	return [`There ${here.changes === 1 ? "is 1 uncommitted change" : `are ${here.changes} uncommitted changes`}.`, `The current branch is ${here.branch}.`, `The target branch is origin/${here.base}.`, upstream];
}

/** The two steps for files not committed, when there are any. */
const committing = (here: Here): string[] => (here.changes > 0 ? ["- Run `git diff` to review the uncommitted changes.", "- Commit them. Follow any instructions the user gave you about writing commit messages."] : []);

/** The push, setting the upstream the first time. */
const pushing = (here: Here): string => (here.published ? "- Push to origin." : `- Push to origin with \`git push -u origin ${here.branch}\`.`);

/** Whether a push would send anything: files to commit first, the branch itself, or commits origin lacks. */
const somethingToPush = (here: Here): boolean => here.changes > 0 || !here.published || here.unpushed > 0;

const FAIL = "If any of these steps fail, ask the user for help.";

/** The steps for Create PR, from the state of the folder at the moment of asking. Pure. */
export function pullRequestPrompt(ask: PullRequestAsk): string {
	const steps = [...committing(ask)];
	if (somethingToPush(ask)) steps.push(pushing(ask));
	steps.push(`- Use \`git diff origin/${ask.base}...\` to review the PR diff.`);
	steps.push(`- Use \`gh pr create --base ${ask.base}${ask.draft ? " --draft" : ""}\` to create a ${ask.draft ? "draft " : ""}PR onto the target branch. Keep the title under 80 characters and the description under five sentences (unless the user has given you other instructions).`);
	return ["The user likes the state of the code.", "", ...standing(ask), "", `The user requested a ${ask.draft ? "draft " : ""}PR.`, "", "Follow these **exact steps** to create it:", "", ...steps, "", FAIL].join("\n");
}

/** A set of steps in the shape every command here sends: what is asked, where the folder stands, the steps, and what to do when they will not go. */
const framed = (asked: string, here: Here, steps: string[], otherwise = FAIL): string => [asked, "", ...standing(here), "", "Follow these **exact steps**:", "", ...steps, "", otherwise].join("\n");

/** Push: what is here, on the pull request. Pure. */
export const pushPrompt = (here: Here): string => framed("The user wants what is here on the pull request.", here, [...committing(here), pushing(here)]);

/**
 * Resolve conflicts: the base merged in, not rebased onto — the branch is
 * on origin already, and a rebase would need a force-push over it. Pure.
 */
export const resolveConflictsPrompt = (here: Here): string =>
	framed(
		`The pull request for this branch has conflicts with origin/${here.base}.`,
		here,
		[
			...committing(here),
			`- Run \`git fetch origin ${here.base}\`.`,
			`- Run \`git merge origin/${here.base}\` and resolve every conflict, keeping what each side meant. Merge; do not rebase, and do not force-push.`,
			"- Run the repository's checks if it has any, and fix what the merge broke.",
			"- Commit the merge.",
			pushing(here),
		],
		"If what a conflict should come to is not clear from the code, ask the user rather than guess. If any of these steps fail, ask the user for help.",
	);

/** Fix checks: the agent reads why they failed with gh, and fixes the cause rather than the check. Pure. */
export const fixChecksPrompt = (here: Here): string =>
	framed(
		"Checks failed on the pull request for this branch.",
		here,
		[
			...committing(here),
			"- Run `gh pr checks` to see which checks failed.",
			"- For each failed GitHub Actions run, run `gh run view <run-id> --log-failed` to read why it failed. For a check that is not an Action, read what its details link says, or say that you could not.",
			"- Fix the cause. Do not skip, disable or loosen a check to make it pass.",
			"- Run the failing check here, if it can be run here.",
			"- Commit the fix. Follow any instructions the user gave you about writing commit messages.",
			pushing(here),
		],
		"If the failure is not in this branch's code — a flaky test, an outage, a secret the runner lacks — say so and stop, rather than changing the code. If any of these steps fail, ask the user for help.",
	);

/** Address review: the agent reads what was asked with gh, and changes what it agrees with. Pure. */
export const addressReviewPrompt = (here: Here): string =>
	framed(
		"Changes were requested on the pull request for this branch.",
		here,
		[
			...committing(here),
			"- Run `gh pr view --comments` to read the reviews.",
			"- Run `gh api repos/{owner}/{repo}/pulls/$(gh pr view --json number --jq .number)/comments` to read the comments on lines of the code.",
			"- Make the changes that were asked for. Where a comment is a question, or you think it is wrong, do not change the code for it: list it for the user at the end.",
			"- Commit the changes. Follow any instructions the user gave you about writing commit messages.",
			pushing(here),
			"- Do not reply to or resolve review threads on GitHub.",
		],
	);

/** The names the window looks for on pi's list of commands, and sends. */
export const CREATE_PR = "create-pr";
export const PUSH = "push";
export const RESOLVE_CONFLICTS = "resolve-conflicts";
export const FIX_CHECKS = "fix-checks";
export const ADDRESS_REVIEW = "address-review";

/**
 * A command of the pull request's: refused while the agent works, and
 * where there is no origin or this is the base itself; else `steps` makes
 * what to send from where the folder stands — or says why not — and the
 * steps go hidden, with `said` in the conversation.
 */
function command(pi: ExtensionAPI, name: string, description: string, steps: (here: Here, args: string) => { content: string; said: string } | { refused: string; level: "info" | "warning" }): void {
	pi.registerCommand(name, {
		description,
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("The agent is working. Ask again when it has finished.", "warning");
				return;
			}
			const git = await standingIn(ctx.cwd);
			if (!git?.base) {
				ctx.ui.notify("There is no origin here for a pull request.", "warning");
				return;
			}
			if (git.branch === git.base) {
				ctx.ui.notify(`This is ${git.base} itself: a pull request is from a branch of its own.`, "warning");
				return;
			}
			const made = steps({ changes: git.changes, branch: git.branch, base: git.base, published: git.remote !== null, unpushed: git.remote?.ahead ?? 0, ahead: git.ahead ?? 0 }, args.trim());
			if ("refused" in made) {
				ctx.ui.notify(made.refused, made.level);
				return;
			}
			// Queued first: "nextTurn" goes with the next message sent, which is the line below.
			pi.sendMessage({ customType: name, content: made.content, display: false }, { deliverAs: "nextTurn" });
			pi.sendUserMessage(made.said);
		},
	});
}

export default function pullRequest(pi: ExtensionAPI): void {
	command(pi, CREATE_PR, "Have the agent commit what is left, push, and open a pull request against the base — `/create-pr draft` for a draft", (here, args) => {
		const draft = args === "draft";
		if (here.changes === 0 && here.ahead === 0) return { refused: `Nothing here that ${here.base} does not have.`, level: "info" };
		return { content: pullRequestPrompt({ ...here, draft }), said: draft ? "Create a draft PR" : "Create a PR" };
	});
	command(pi, PUSH, "Have the agent commit what is left and push it to the pull request", (here) => {
		if (!somethingToPush(here)) return { refused: "Nothing here that origin does not have.", level: "info" };
		return { content: pushPrompt(here), said: "Push the changes" };
	});
	command(pi, RESOLVE_CONFLICTS, "Have the agent merge the base in and resolve the pull request's conflicts", (here) => ({ content: resolveConflictsPrompt(here), said: "Resolve the conflicts" }));
	command(pi, FIX_CHECKS, "Have the agent read why the pull request's checks failed, fix the cause, and push", (here) => ({ content: fixChecksPrompt(here), said: "Fix the failing checks" }));
	command(pi, ADDRESS_REVIEW, "Have the agent read the changes asked for on the pull request, make them, and push", (here) => ({ content: addressReviewPrompt(here), said: "Address the review" }));
}
