import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CITIES, pickCity } from "../electron/cities.js";
import { branchOf, changesIn, fetchOrigin, makeWorkspace, removeWorktree, repositoryOf, startOf } from "../electron/git.js";
import { login } from "../electron/github.js";

const run = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();

/** A remote with one commit on main, and a clone of it — the two a person has after `git clone`. */
function cloned() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "octave-git-")));
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

/** A commit on the remote that the clone has not fetched. */
function aheadOnRemote({ seed, origin }) {
	writeFileSync(join(seed, "b.txt"), "two\n");
	run(seed, "add", ".");
	run(seed, "commit", "-q", "-m", "two");
	run(seed, "push", "-q", origin, "main");
	return run(seed, "rev-parse", "HEAD");
}

test("a workspace starts from the remote's latest commit, and the clone's own branch does not move", async () => {
	const repo = cloned();
	const before = run(repo.root, "rev-parse", "HEAD");
	const latest = aheadOnRemote(repo);
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "workspaces", "repo"), owner: "me" });
	assert.ok(CITIES.includes(made.name));
	assert.equal(made.branch, `me/${made.name}`);
	assert.equal(made.path, join(repo.dir, "workspaces", "repo", made.name));
	assert.equal(run(made.path, "rev-parse", "HEAD"), latest);
	assert.equal(await branchOf(made.path), made.branch);
	assert.equal(run(repo.root, "rev-parse", "HEAD"), before);
	assert.equal(await branchOf(repo.root), "main");
});

test("a workspace's branch tracks nothing, so a push cannot land on main", async () => {
	const repo = cloned();
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me" });
	assert.throws(() => run(made.path, "rev-parse", "--abbrev-ref", "@{upstream}"));
});

test("with no one to name, the branch is the city alone", async () => {
	const repo = cloned();
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: null });
	assert.equal(made.branch, made.name);
});

test("a city is not reused while its folder is there or a branch still carries it", async () => {
	const repo = cloned();
	const into = join(repo.dir, "ws");
	mkdirSync(join(into, "lisbon"), { recursive: true });
	run(repo.root, "branch", "someone/porto");
	const random = () => 0; // Always the first city still free.
	const free = CITIES.filter((c) => c !== "lisbon" && c !== "porto");
	assert.equal(pickCity(["lisbon", "porto"], random), free[0]);
	const made = await makeWorkspace(repo.root, { into, owner: "me" });
	assert.notEqual(made.name, "lisbon");
	assert.notEqual(made.name, "porto");
});

test("when every city is taken, the next round of them", () => {
	assert.equal(pickCity(CITIES, () => 0), `${CITIES[0]}-v2`);
	assert.equal(pickCity([...CITIES, ...CITIES.map((c) => `${c}-v2`)], () => 0), `${CITIES[0]}-v3`);
});

test("the start is the remote's default branch, found even where its HEAD is not recorded", async () => {
	const repo = cloned();
	assert.equal(await startOf(repo.root), "origin/main");
	run(repo.root, "remote", "set-head", "origin", "--delete");
	assert.equal(await startOf(repo.root), "origin/main");
});

test("a repository with no remote starts workspaces from the branch its clone has out", async () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "octave-git-")));
	run(dir, "init", "-q");
	run(dir, "commit", "-q", "--allow-empty", "-m", "one");
	run(dir, "switch", "-q", "-c", "trunk");
	assert.equal(await fetchOrigin(dir), false);
	assert.equal(await startOf(dir), "trunk");
	const made = await makeWorkspace(dir, { into: `${dir}-ws`, owner: "me" });
	assert.ok(existsSync(join(made.path, ".git")));
});

test("a fetch that cannot reach the remote is not the end of making a workspace", async () => {
	const repo = cloned();
	run(repo.root, "remote", "set-url", "origin", join(repo.dir, "gone.git"));
	assert.equal(await fetchOrigin(repo.root), false);
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me" });
	assert.equal(run(made.path, "rev-parse", "HEAD"), run(repo.root, "rev-parse", "origin/main"));
});

test("a repository is named by its clone's folder, from the clone and from any of its worktrees", async () => {
	const repo = cloned();
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me" });
	assert.equal(await repositoryOf(repo.root), repo.root);
	assert.equal(await repositoryOf(made.path), repo.root);
	mkdirSync(join(repo.root, "sub"));
	assert.equal(await repositoryOf(join(repo.root, "sub")), repo.root);
	assert.equal(await repositoryOf(repo.origin), null, "a bare repository has no working tree to be in");
	assert.equal(await repositoryOf(realpathSync(mkdtempSync(join(tmpdir(), "octave-none-")))), null);
});

test("with no gh to ask, there is no one signed in", async () => {
	const path = process.env.PATH;
	process.env.PATH = "";
	try {
		assert.equal(await login(), null);
	} finally {
		process.env.PATH = path;
	}
});

test("a clone is asked for by owner/name or by a GitHub address, and nothing else", async () => {
	const { repositoryName } = await import("../electron/github.js");
	const want = { owner: "minkyojung", name: "pi-web-ui" };
	for (const source of ["minkyojung/pi-web-ui", " minkyojung/pi-web-ui.git ", "https://github.com/minkyojung/pi-web-ui", "https://github.com/minkyojung/pi-web-ui.git", "https://github.com/minkyojung/pi-web-ui/", "git@github.com:minkyojung/pi-web-ui.git"]) {
		assert.deepEqual(repositoryName(source), want, source);
	}
	assert.deepEqual(repositoryName("a/b.c_d-e"), { owner: "a", name: "b.c_d-e" });
	for (const source of ["", "pi-web-ui", "a/b/c", "a/..", "a/.", "https://gitlab.com/a/b", "http://github.com/a/b", "https://github.com/a/b/tree/main", "--upload-pack=x/y", "a/b; rm -rf ~", "file:///etc/passwd", null]) {
		assert.equal(repositoryName(source), null, String(source));
	}
});

test("a workspace's changes are the person's — changed, added, untracked — and never the app's own folder", async () => {
	const repo = cloned();
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me" });
	assert.equal(await changesIn(made.path), 0);
	mkdirSync(join(made.path, ".pi", "history"), { recursive: true });
	writeFileSync(join(made.path, ".pi", ".gitignore"), "trash/\n");
	writeFileSync(join(made.path, ".pi", "history", "a.jsonl"), "{}\n");
	assert.equal(await changesIn(made.path), 0, "Octave writes .pi/ into every folder it opens");
	writeFileSync(join(made.path, "a.txt"), "changed\n");
	mkdirSync(join(made.path, "new"));
	writeFileSync(join(made.path, "new", "b.txt"), "x\n");
	writeFileSync(join(made.path, "new", "c.txt"), "x\n");
	assert.equal(await changesIn(made.path), 3, "each untracked file, not its folder once");
});

test("removing a workspace takes the folder and leaves the branch, whatever was in the folder", async () => {
	const repo = cloned();
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me" });
	writeFileSync(join(made.path, "work.txt"), "kept on the branch\n");
	run(made.path, "add", ".");
	run(made.path, "commit", "-q", "-m", "work");
	mkdirSync(join(made.path, ".pi"));
	writeFileSync(join(made.path, ".pi", ".gitignore"), "trash/\n");
	writeFileSync(join(made.path, "loose.txt"), "never committed\n");
	await removeWorktree(repo.root, made.path);
	assert.equal(existsSync(made.path), false);
	assert.equal(run(repo.root, "worktree", "list").includes(made.path), false, "git has forgotten the worktree");
	assert.equal(run(repo.root, "log", "-1", "--format=%s", made.branch), "work", "the branch and its commit are still there");
});
