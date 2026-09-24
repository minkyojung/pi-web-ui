import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CITIES, pickCity } from "../electron/cities.js";
import { branchOf, changesIn, fetchOrigin, makeWorkspace, onRemote, remoteBranches, removeWorktree, repositoryOf, startOf } from "../electron/git.js";
import { deviceCodeFrom, login, signIn, standing } from "../electron/github.js";

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

test("with no gh to ask, there is no one signed in, and the standing is that gh is missing", async () => {
	const path = process.env.PATH;
	process.env.PATH = "";
	try {
		assert.equal(await login(), null);
		assert.deepEqual(await standing(), { state: "missing" });
	} finally {
		process.env.PATH = path;
	}
});

/** A gh of our own first on PATH, made of `script`, for as long as `run` runs. */
async function withGh(script, run) {
	const dir = mkdtempSync(join(tmpdir(), "octave-gh-"));
	writeFileSync(join(dir, "gh"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
	const path = process.env.PATH;
	process.env.PATH = `${dir}:${path}`;
	try {
		return await run();
	} finally {
		process.env.PATH = path;
	}
}

test("gh's one-time code and the address for it are read as they come, and not before both are there", () => {
	assert.equal(deviceCodeFrom("! First copy your one-time code: AB12"), null);
	assert.deepEqual(deviceCodeFrom("! First copy your one-time code: AB12-CD34\nOpen this URL to continue in your web browser: https://github.com/login/device\n"), { userCode: "AB12-CD34", verificationUri: "https://github.com/login/device" });
	assert.deepEqual(deviceCodeFrom("! One-time code (AB12-CD34) copied to clipboard\nOpen this URL to continue in your web browser: https://github.com/login/device"), { userCode: "AB12-CD34", verificationUri: "https://github.com/login/device" });
});

test("signing in shows gh's code as gh says it, and ends as gh ends — well, or in its own words", async () => {
	const said = [];
	const ok = await withGh('case "$*" in *--version*) echo "gh version 0";; *"auth login"*) echo "! First copy your one-time code: AB12-CD34" >&2; echo "Open this URL to continue in your web browser: https://github.com/login/device" >&2; exit 0;; *) exit 1;; esac', () => signIn({ onCode: (code) => said.push(code) }));
	assert.deepEqual(ok, { ok: true });
	assert.deepEqual(said, [{ userCode: "AB12-CD34", verificationUri: "https://github.com/login/device" }]);
	const bad = await withGh('echo "error connecting to github.com" >&2; exit 1', () => signIn({ onCode: () => assert.fail("no code was said") }));
	assert.deepEqual(bad, { error: "error connecting to github.com" });
	const giving = new AbortController();
	const gone = withGh("sleep 30", () => signIn({ onCode: () => {}, signal: giving.signal }));
	giving.abort();
	assert.deepEqual(await gone, { cancelled: true });
	const standings = await withGh('case "$*" in *--version*) echo "gh version 0";; *"api user"*) echo "someone";; esac', async () => [await standing()]);
	assert.deepEqual(standings, [{ state: "signed-in", login: "someone" }]);
	const out = await withGh('case "$*" in *--version*) echo "gh version 0";; *) exit 1;; esac', () => standing());
	assert.deepEqual(out, { state: "signed-out" });
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

test("a workspace can be started from another of the remote's branches, fetched first, and not from one it does not have", async () => {
	const repo = cloned();
	// A branch made on the remote after the clone: only a fetch would know it.
	run(repo.seed, "checkout", "-q", "-b", "me/email-auth");
	writeFileSync(join(repo.seed, "auth.txt"), "sign in\n");
	run(repo.seed, "add", ".");
	// Dated after the first, which was made within the same second: the order is by when.
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "auth"], { cwd: repo.seed, env: { ...process.env, GIT_COMMITTER_DATE: new Date(Date.now() + 60_000).toISOString() } });
	run(repo.seed, "push", "-q", repo.origin, "me/email-auth");
	const listed = await remoteBranches(repo.root);
	assert.deepEqual(listed, { branches: ["me/email-auth", "main"], base: "main" }, "the latest worked on first, and origin/HEAD is not a branch");
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me", start: "me/email-auth" });
	assert.equal(existsSync(join(made.path, "auth.txt")), true, "it stands on that branch's commit");
	assert.notEqual(made.branch, "me/email-auth", "on a branch of its own, as any workspace is");
	assert.throws(() => run(made.path, "rev-parse", "--abbrev-ref", "@{u}"), /no upstream/, "and does not track the one it started from: a push would go there");
	await assert.rejects(makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me", start: "nobody/none" }), /no branch called nobody\/none/);
	await assert.rejects(makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me", start: "--upload-pack=x" }), /no branch called/);
});

test("gh's issues are read strictly: a number and a title, a body or none, and nothing else passed on", async () => {
	const { issuesFrom } = await import("../electron/github.js");
	assert.deepEqual(issuesFrom('[{"number":12,"title":"Sign in","body":"with email"},{"number":13,"title":"No body","body":null,"url":"x"}]'), [
		{ number: 12, title: "Sign in", body: "with email" },
		{ number: 13, title: "No body", body: "" },
	]);
	assert.deepEqual(issuesFrom("[]"), []);
	assert.deepEqual(issuesFrom('[{"number":"12","title":"x"},{"title":"x"},null,{"number":1,"title":2}]'), []);
	for (const out of ["", "not json", '{"number":1}']) assert.equal(issuesFrom(out), null);
});

test("a new workspace's branch is not on the remote until pushed — and never read as merged, though its every commit is in the base", async () => {
	const repo = cloned();
	const made = await makeWorkspace(repo.root, { into: join(repo.dir, "ws"), owner: "me" });
	assert.equal(await onRemote(repo.root, made.branch), false);
	// What a fresh branch and a merged one have in common — and why git is not asked which is which:
	run(repo.root, "merge-base", "--is-ancestor", made.branch, "origin/main");
	run(made.path, "push", "-q", "-u", "origin", made.branch);
	assert.equal(await onRemote(repo.root, made.branch), true);
});

test("GitHub's pull requests are read by branch, with their checks folded and the rest read strictly", async () => {
	const { pullRequestsFromGraph } = await import("../electron/github.js");
	const pr = (fields) => ({ associatedPullRequests: { nodes: [fields] } });
	const map = pullRequestsFromGraph(JSON.stringify({ data: { repository: {
		b0: pr({ number: 30, state: "OPEN", url: "https://x/30", isDraft: false, reviewDecision: "APPROVED", commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: "" }, { state: "FAILURE" }] } } } }] } }),
		b1: pr({ number: 9, state: "CLOSED", commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: "nope" } } } }] } }),
		b2: pr({ number: "3", state: "OPEN" }),
		b3: { associatedPullRequests: { nodes: [] } },
	} } }), ["me/x", "me/y", "me/z", "me/none"]);
	assert.deepEqual([...map], [
		["me/x", { number: 30, title: "", state: "OPEN", url: "https://x/30", draft: false, review: "APPROVED", checks: { total: 3, pending: 1, failed: 1 }, merge: "", added: null, deleted: null, commits: null, method: "" }],
		["me/y", { number: 9, title: "", state: "CLOSED", url: null, draft: false, review: "", checks: { total: 0, pending: 0, failed: 0 }, merge: "", added: null, deleted: null, commits: null, method: "" }],
	]);
	assert.equal(pullRequestsFromGraph("nope", ["me/x"]), null);
});
