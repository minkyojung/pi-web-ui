import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import pullRequest, { addressReviewPrompt, fixChecksPrompt, pullRequestPrompt, pushPrompt, resolveConflictsPrompt } from "../pullRequest.ts";

const ask = (over = {}) => ({ changes: 0, branch: "me/x", base: "main", published: true, unpushed: 0, ahead: 2, draft: false, ...over });
const steps = (prompt) => prompt.split("\n").filter((line) => line.startsWith("- "));

test("everything pushed: review the diff, open the pull request — Conductor's two steps", () => {
	const prompt = pullRequestPrompt(ask());
	assert.match(prompt, /^The user likes the state of the code\.\n\nThere are 0 uncommitted changes\.\nThe current branch is me\/x\.\nThe target branch is origin\/main\.\nAn upstream branch exists\.\n/);
	assert.deepEqual(steps(prompt), [
		"- Use `git diff origin/main...` to review the PR diff.",
		"- Use `gh pr create --base main` to create a PR onto the target branch. Keep the title under 80 characters and the description under five sentences (unless the user has given you other instructions).",
	]);
	assert.match(prompt, /If any of these steps fail, ask the user for help\.$/);
});

test("a step only where there is something for it to do: a commit for files not committed, a push for what origin lacks", () => {
	assert.deepEqual(steps(pullRequestPrompt(ask({ changes: 3 }))).slice(0, 3), ["- Run `git diff` to review the uncommitted changes.", "- Commit them. Follow any instructions the user gave you about writing commit messages.", "- Push to origin."]);
	const unpushed = pullRequestPrompt(ask({ unpushed: 2 }));
	assert.match(unpushed, /An upstream branch exists, and 2 commits are not on it yet\./);
	assert.equal(steps(unpushed)[0], "- Push to origin.");
	const fresh = pullRequestPrompt(ask({ published: false, changes: 1 }));
	assert.match(fresh, /There is 1 uncommitted change\.\n.*\n.*\nThere is no upstream branch yet\./);
	assert.equal(steps(fresh)[2], "- Push to origin with `git push -u origin me/x`.", "the first push sets the upstream");
});

test("a draft says so, and asks gh for one", () => {
	const prompt = pullRequestPrompt(ask({ draft: true }));
	assert.match(prompt, /The user requested a draft PR\./);
	assert.match(steps(prompt).at(-1), /^- Use `gh pr create --base main --draft` to create a draft PR onto the target branch\./);
});

/** A clone of a remote with one commit on main, a fake pi, and what the command did. */
function setUp() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "octave-pr-")));
	const run = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();
	const seed = join(dir, "seed");
	mkdirSync(seed);
	run(seed, "init", "-q");
	writeFileSync(join(seed, "a.txt"), "one\n");
	run(seed, "add", ".");
	run(seed, "commit", "-q", "-m", "one");
	run(dir, "clone", "-q", "--bare", seed, "origin.git");
	run(dir, "clone", "-q", join(dir, "origin.git"), "repo");
	const root = join(dir, "repo");
	const commands = {};
	const done = [];
	const notes = [];
	pullRequest({
		registerCommand: (name, options) => (commands[name] = options),
		sendMessage: (message, options) => done.push({ sendMessage: message, options }),
		sendUserMessage: (content) => done.push({ sendUserMessage: content }),
	});
	const press = (args, idle = true, name = "create-pr") => commands[name].handler(args, { cwd: root, isIdle: () => idle, ui: { notify: (text, type) => notes.push({ text, type }) } });
	return { root, run, done, notes, press };
}

test("the command sends the steps hidden and 'Create a PR' in the conversation, as Conductor does", async () => {
	const { root, run, done, notes, press } = setUp();
	run(root, "checkout", "-q", "-b", "me/x");
	writeFileSync(join(root, "b.txt"), "two\n");
	await press("");
	assert.deepEqual(notes, []);
	assert.equal(done.length, 2);
	assert.equal(done[0].sendMessage.customType, "create-pr");
	assert.equal(done[0].sendMessage.display, false);
	assert.deepEqual(done[0].options, { deliverAs: "nextTurn" });
	assert.match(done[0].sendMessage.content, /There is 1 uncommitted change\.\nThe current branch is me\/x\.\nThe target branch is origin\/main\.\nThere is no upstream branch yet\./);
	assert.deepEqual(done[1], { sendUserMessage: "Create a PR" });
	await press("draft");
	assert.deepEqual(done[3], { sendUserMessage: "Create a draft PR" });
	assert.match(done[2].sendMessage.content, /--draft/);
});

test("refused, and said why: while the agent works, on the base itself, with nothing to put in it, with no origin", async () => {
	const { root, run, done, notes, press } = setUp();
	run(root, "checkout", "-q", "-b", "me/x");
	await press("", false);
	await press("");
	run(root, "checkout", "-q", "main");
	writeFileSync(join(root, "b.txt"), "two\n");
	await press("");
	run(root, "remote", "remove", "origin");
	run(root, "checkout", "-q", "-b", "me/y");
	await press("");
	assert.deepEqual(done, [], "nothing sent");
	assert.deepEqual(notes.map((note) => note.text), [
		"The agent is working. Ask again when it has finished.",
		"Nothing here that main does not have.",
		"This is main itself: a pull request is from a branch of its own.",
		"There is no origin here for a pull request.",
	]);
});

test("Push: commit what is left, then push — setting the upstream the first time", () => {
	const prompt = pushPrompt(ask({ changes: 2 }));
	assert.match(prompt, /^The user wants what is here on the pull request\.\n\nThere are 2 uncommitted changes\./);
	assert.deepEqual(steps(prompt), ["- Run `git diff` to review the uncommitted changes.", "- Commit them. Follow any instructions the user gave you about writing commit messages.", "- Push to origin."]);
	assert.deepEqual(steps(pushPrompt(ask({ published: false, unpushed: 0 }))), ["- Push to origin with `git push -u origin me/x`."]);
});

test("Resolve conflicts: the base merged in, never rebased or force-pushed, and asked about rather than guessed", () => {
	const prompt = resolveConflictsPrompt(ask());
	assert.match(prompt, /^The pull request for this branch has conflicts with origin\/main\./);
	assert.deepEqual(steps(prompt).slice(0, 2), ["- Run `git fetch origin main`.", "- Run `git merge origin/main` and resolve every conflict, keeping what each side meant. Merge; do not rebase, and do not force-push."]);
	assert.equal(steps(prompt).at(-1), "- Push to origin.");
	assert.match(prompt, /ask the user rather than guess/);
	assert.equal(steps(resolveConflictsPrompt(ask({ changes: 1 })))[1], "- Commit them. Follow any instructions the user gave you about writing commit messages.", "what is not committed first, so the merge can start");
});

test("Fix checks: why is read with gh, the cause fixed and never the check, and a failure not of this code said and left", () => {
	const prompt = fixChecksPrompt(ask());
	assert.deepEqual(steps(prompt).slice(0, 2), ["- Run `gh pr checks` to see which checks failed.", "- For each failed GitHub Actions run, run `gh run view <run-id> --log-failed` to read why it failed. For a check that is not an Action, read what its details link says, or say that you could not."]);
	assert.ok(steps(prompt).includes("- Fix the cause. Do not skip, disable or loosen a check to make it pass."));
	assert.match(prompt, /a flaky test, an outage, a secret the runner lacks — say so and stop/);
});

test("Address review: the reviews and the line comments read with gh, what is agreed with changed, the rest listed, no replies", () => {
	const prompt = addressReviewPrompt(ask());
	assert.ok(steps(prompt).includes("- Run `gh pr view --comments` to read the reviews."));
	assert.ok(steps(prompt).some((step) => step.includes("gh api repos/{owner}/{repo}/pulls/")));
	assert.ok(steps(prompt).some((step) => step.includes("list it for the user at the end")));
	assert.equal(steps(prompt).at(-1), "- Do not reply to or resolve review threads on GitHub.");
});

test("each command sends its steps hidden and its own line in the conversation; Push with nothing to push is refused", async () => {
	const { root, run, done, notes, press } = setUp();
	run(root, "checkout", "-q", "-b", "me/x");
	writeFileSync(join(root, "b.txt"), "two\n");
	for (const [name, said] of [["push", "Push the changes"], ["resolve-conflicts", "Resolve the conflicts"], ["fix-checks", "Fix the failing checks"], ["address-review", "Address the review"]]) {
		await press("", true, name);
		const [hidden, line] = done.splice(0);
		assert.equal(hidden.sendMessage.customType, name);
		assert.equal(hidden.sendMessage.display, false);
		assert.deepEqual(hidden.options, { deliverAs: "nextTurn" });
		assert.match(hidden.sendMessage.content, /There is 1 uncommitted change\./);
		assert.deepEqual(line, { sendUserMessage: said });
	}
	run(root, "add", ".");
	run(root, "commit", "-q", "-m", "two");
	run(root, "push", "-q", "-u", "origin", "me/x");
	await press("", true, "push");
	assert.deepEqual(done, []);
	assert.deepEqual(notes.map((note) => note.text), ["Nothing here that origin does not have."]);
});

test("Create PR on a branch never pushed, with commits and nothing uncommitted: what the base lacks is the pull request", async () => {
	const { root, run, done, notes, press } = setUp();
	run(root, "checkout", "-q", "-b", "me/x");
	writeFileSync(join(root, "b.txt"), "two\n");
	run(root, "add", ".");
	run(root, "commit", "-q", "-m", "two");
	await press("");
	assert.deepEqual(notes, []);
	assert.match(done[0].sendMessage.content, /There are 0 uncommitted changes\.\n.*\n.*\nThere is no upstream branch yet\./);
	assert.match(done[0].sendMessage.content, /- Push to origin with `git push -u origin me\/x`\./);
});
