import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { baseLine, baseOf, standingIn } from "../standing.ts";

const run = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();

/** A remote with one commit on main, and a clone of it. */
function cloned() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "octave-standing-")));
	const seed = join(dir, "seed");
	mkdirSync(seed);
	run(seed, "init", "-q");
	writeFileSync(join(seed, "a.txt"), "one\n");
	run(seed, "add", ".");
	run(seed, "commit", "-q", "-m", "one");
	run(dir, "clone", "-q", "--bare", seed, "origin.git");
	run(dir, "clone", "-q", join(dir, "origin.git"), "repo");
	return { dir, seed, origin: join(dir, "origin.git"), root: join(dir, "repo") };
}

test("no repository, or no branch, is nothing", async () => {
	const dir = mkdtempSync(join(tmpdir(), "octave-standing-none-"));
	assert.equal(await standingIn(dir), null);
	const { root } = cloned();
	run(root, "checkout", "-q", "--detach");
	assert.equal(await standingIn(root), null);
});

test("a fresh branch off the base: nothing changed, nothing ahead or behind", async () => {
	const { root } = cloned();
	run(root, "checkout", "-q", "-b", "me/x");
	assert.deepEqual(await standingIn(root), { branch: "me/x", base: "main", changes: 0, ahead: 0, behind: 0 });
});

test("changes are counted without the app's own folder; commits count ahead; the base moving on counts behind, once fetched", async () => {
	const repo = cloned();
	const { root } = repo;
	run(root, "checkout", "-q", "-b", "me/x");
	mkdirSync(join(root, ".pi"));
	writeFileSync(join(root, ".pi", "log"), "x\n");
	writeFileSync(join(root, "b.txt"), "two\n");
	writeFileSync(join(root, "a.txt"), "changed\n");
	assert.equal((await standingIn(root)).changes, 2);
	run(root, "add", "a.txt", "b.txt");
	run(root, "commit", "-q", "-m", "two");
	assert.deepEqual(await standingIn(root), { branch: "me/x", base: "main", changes: 0, ahead: 1, behind: 0 });
	writeFileSync(join(repo.seed, "c.txt"), "three\n");
	run(repo.seed, "add", ".");
	run(repo.seed, "commit", "-q", "-m", "three");
	run(repo.seed, "push", "-q", repo.origin, "main");
	assert.equal((await standingIn(root)).behind, 0, "not fetched yet: what was last fetched stands");
	run(root, "fetch", "-q");
	assert.deepEqual(await standingIn(root), { branch: "me/x", base: "main", changes: 0, ahead: 1, behind: 1 });
});

test("with no remote there is no base, and ahead and behind are nothing", async () => {
	const dir = mkdtempSync(join(tmpdir(), "octave-standing-local-"));
	run(dir, "init", "-q");
	writeFileSync(join(dir, "a.txt"), "x\n");
	run(dir, "add", ".");
	run(dir, "commit", "-q", "-m", "one");
	assert.deepEqual(await standingIn(dir), { branch: "main", base: null, changes: 0, ahead: null, behind: null });
});

test("the base is told to the agent as what a diff or a pull request is against, and not at all without one", async () => {
	const { root } = cloned();
	assert.equal(await baseOf(root), "origin/main");
	assert.match(baseLine("origin/main"), /^This branch was started from origin\/main, .*pull request is against it/);
	assert.equal(baseLine(null), null);
});
