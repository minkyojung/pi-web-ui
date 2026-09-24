import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import pullRequest, { pullRequestPrompt } from "../pullRequest.ts";

const ask = (over = {}) => ({ changes: 0, branch: "me/x", base: "main", published: true, unpushed: 0, draft: false, ...over });
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
	const press = (args, idle = true) => commands["create-pr"].handler(args, { cwd: root, isIdle: () => idle, ui: { notify: (text, type) => notes.push({ text, type }) } });
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
		"The agent is working. Ask for the pull request when it has finished.",
		"Nothing here that main does not have.",
		"This is main itself: a pull request is from a branch of its own.",
		"There is no origin here to open a pull request on.",
	]);
});
