import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CITIES, pickCity } from "../electron/cities.js";
import { branchOf, changesIn, fetchOrigin, fillIdentity, identity, makeWorkspace, onRemote, remoteBranches, removeWorktree, repositoryOf, setIdentity, startOf } from "../electron/git.js";
import { deviceCodeFrom, emailsFrom, login, noreplyEmail, preferredEmail, profileFrom, signIn, standing } from "../electron/github.js";

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
	const standings = await withGh(`case "$*" in *--version*) echo "gh version 0";; *"api user"*) echo '{"login":"someone","id":7,"name":"Some One","avatar_url":"https://avatars.githubusercontent.com/u/7?v=4","html_url":"https://github.com/someone"}';; esac`, async () => [await standing(), await login()]);
	assert.deepEqual(standings, [{ state: "signed-in", login: "someone", name: "Some One", avatarUrl: "https://avatars.githubusercontent.com/u/7?v=4", url: "https://github.com/someone", id: 7, email: null }, "someone"]);
	const out = await withGh('case "$*" in *--version*) echo "gh version 0";; *) exit 1;; esac', () => standing());
	assert.deepEqual(out, { state: "signed-out" });
});

/** GitHub's answer to `gh api user`, as it gives it for its own example account (docs.github.com, "Get the authenticated user"), cut to what is read and a little more. */
const octocat = { login: "octocat", id: 1, avatar_url: "https://github.com/images/error/octocat_happy.gif", html_url: "https://github.com/octocat", name: "monalisa octocat", company: "GitHub", email: "octocat@github.com", bio: "There once was...", followers: 20 };

test("the person is read off GitHub's answer: login, name, picture, page, number and public email — nothing else", () => {
	assert.deepEqual(profileFrom(JSON.stringify(octocat)), { login: "octocat", name: "monalisa octocat", avatarUrl: "https://github.com/images/error/octocat_happy.gif", url: "https://github.com/octocat", id: 1, email: "octocat@github.com" });
	assert.equal(profileFrom(JSON.stringify({ ...octocat, email: null })).email, null, "no public email is no email");
	assert.equal(profileFrom(JSON.stringify({ ...octocat, email: "not an email" })).email, null);
});

test("what a person has not filled in is said to be missing, not made up", () => {
	assert.deepEqual(profileFrom(JSON.stringify({ ...octocat, name: null })).name, null, "no name is no name, not the login again");
	assert.equal(profileFrom(JSON.stringify({ ...octocat, name: "  " })).name, null);
	assert.equal(profileFrom(JSON.stringify({ ...octocat, avatar_url: "http://example.com/a.png" })).avatarUrl, null, "a picture only over https");
	assert.equal(profileFrom(JSON.stringify({ ...octocat, html_url: "https://example.com/octocat" })).url, "https://github.com/octocat", "the page is GitHub's, whatever the answer says");
	assert.equal(profileFrom(JSON.stringify({ ...octocat, id: "1" })).id, null);
});

test("anything that is not GitHub's answer about a person is no one", () => {
	for (const out of [null, "", "someone", "not json", "[]", "null", JSON.stringify({ id: 1 }), JSON.stringify({ login: "" }), JSON.stringify({ login: 7 }), JSON.stringify({ message: "Bad credentials" })]) {
		assert.equal(profileFrom(out), null, String(out));
	}
});

/** A machine of its own for as long as `run` runs: a home, and a global git configuration that is a file here rather than the person's. */
async function withHome(run) {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "octave-home-")));
	const saved = { ...process.env };
	Object.assign(process.env, { HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1" });
	for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) delete process.env[key];
	try {
		return await run(home);
	} finally {
		for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
	}
}

test("a machine git has not been told about makes up who commits, and says it made them up", async () => {
	await withHome(async () => {
		const who = await identity();
		assert.equal(who.set, false);
		// What it makes up is the machine's — a Mac's user and its name, as
		// williamjung@Williams-MacBook-Pro.local — or nothing where it cannot.
		for (const value of [who.name, who.email]) assert.ok(value === null || typeof value === "string");
	});
});

test("who commits is what git was told, once it has a name and an email", async () => {
	await withHome(async (home) => {
		execFileSync("git", ["config", "--global", "user.name", "Mona Lisa"], { cwd: home });
		assert.equal((await identity()).set, false, "a name alone is not enough: the email is still made up");
		execFileSync("git", ["config", "--global", "user.email", "mona@example.com"], { cwd: home });
		assert.deepEqual(await identity(), { name: "Mona Lisa", email: "mona@example.com", set: true });
	});
});

test("filling in who commits writes only what git has no word for, and leaves the rest as the person set it", async () => {
	await withHome(async (home) => {
		execFileSync("git", ["config", "--global", "user.name", "Mona Lisa"], { cwd: home });
		assert.deepEqual(await fillIdentity({ name: "monalisa octocat", email: "1+octocat@users.noreply.github.com" }), {});
		assert.deepEqual(await identity(), { name: "Mona Lisa", email: "1+octocat@users.noreply.github.com", set: true });
		assert.deepEqual(await fillIdentity({ name: "someone else", email: "else@example.com" }), {}, "nothing is left to fill");
		assert.deepEqual(await identity(), { name: "Mona Lisa", email: "1+octocat@users.noreply.github.com", set: true });
		const repo = join(home, "repo");
		mkdirSync(repo);
		execFileSync("git", ["init", "-q"], { cwd: repo });
		execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "first"], { cwd: repo });
		assert.equal(execFileSync("git", ["log", "-1", "--format=%an <%ae>"], { cwd: repo, encoding: "utf8" }).trim(), "Mona Lisa <1+octocat@users.noreply.github.com>", "a commit is made as them");
	});
});

test("what is not a name or an email is not written", async () => {
	await withHome(async () => {
		for (const bad of [{ name: "", email: "a@b" }, { name: "a", email: "not an email" }, { name: "a\nb", email: "a@b" }, { name: "a", email: "<a@b>" }, {}]) {
			assert.ok((await fillIdentity(bad)).error, JSON.stringify(bad));
		}
		assert.equal((await identity()).set, false);
	});
});

test("GitHub's private address for a person is made of their number and their login", () => {
	assert.equal(noreplyEmail(1, "octocat"), "1+octocat@users.noreply.github.com");
	assert.equal(noreplyEmail(null, "octocat"), null, "without the number there is no address that stays theirs");
	assert.equal(noreplyEmail(1, ""), null);
});

test("the person's email addresses are read off GitHub's list, the verified ones only", () => {
	const list = [
		{ email: "octocat@github.com", verified: true, primary: true, visibility: "public" },
		{ email: "old@example.com", verified: false, primary: false, visibility: null },
		{ email: "1+octocat@users.noreply.github.com", verified: true, primary: false, visibility: null },
	];
	assert.deepEqual(emailsFrom(JSON.stringify(list)), [
		{ email: "octocat@github.com", primary: true, visibility: "public" },
		{ email: "1+octocat@users.noreply.github.com", primary: false, visibility: null },
	]);
	for (const out of [null, "", "not json", "{}", JSON.stringify({ message: "Not Found" })]) assert.equal(emailsFrom(out), null, String(out));
	assert.deepEqual(emailsFrom("[]"), []);
});

test("the address offered to commit as is GitHub Desktop's: the primary if public, else a noreply one, else the first, else one made", () => {
	const me = { login: "octocat", id: 1, email: null };
	const primary = { email: "octocat@github.com", primary: true, visibility: "public" };
	const hidden = { ...primary, visibility: "private" };
	const noreply = { email: "1+octocat@users.noreply.github.com", primary: false, visibility: null };
	const work = { email: "mona@work.example", primary: false, visibility: null };
	assert.equal(preferredEmail(me, [work, primary, noreply]), "octocat@github.com");
	assert.equal(preferredEmail(me, [{ ...primary, visibility: null }]), "octocat@github.com", "no visibility is an older GitHub's public");
	assert.equal(preferredEmail(me, [work, hidden, noreply]), "1+octocat@users.noreply.github.com", "a private primary is not put in every commit");
	assert.equal(preferredEmail(me, [work, hidden]), "mona@work.example");
	assert.equal(preferredEmail(me, []), "1+octocat@users.noreply.github.com");
	// Without the list — a sign-in that was never let read it — the profile's public email stands for a public primary.
	assert.equal(preferredEmail({ ...me, email: "octocat@github.com" }, null), "octocat@github.com");
	assert.equal(preferredEmail(me, null), "1+octocat@users.noreply.github.com");
	assert.equal(preferredEmail({ login: "octocat", id: null, email: null }, null), null, "nothing to make one from");
});

test("setting who commits writes the name and the email, over what was there", async () => {
	await withHome(async (home) => {
		execFileSync("git", ["config", "--global", "user.name", "Mona Lisa"], { cwd: home });
		execFileSync("git", ["config", "--global", "user.email", "mona@example.com"], { cwd: home });
		assert.deepEqual(await setIdentity({ name: "monalisa octocat", email: "1+octocat@users.noreply.github.com" }), {});
		assert.deepEqual(await identity(), { name: "monalisa octocat", email: "1+octocat@users.noreply.github.com", set: true });
		for (const bad of [{ name: "", email: "a@b" }, { name: "a", email: "not an email" }, { name: "a\nb", email: "a@b" }, { name: "a", email: "<a@b>" }, {}]) {
			assert.ok((await setIdentity(bad)).error, JSON.stringify(bad));
		}
		assert.deepEqual(await identity(), { name: "monalisa octocat", email: "1+octocat@users.noreply.github.com", set: true }, "nothing bad was written");
	});
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
		["me/x", { number: 30, state: "OPEN", url: "https://x/30", draft: false, review: "APPROVED", checks: { total: 3, pending: 1, failed: 1 }, merge: "", method: "" }],
		["me/y", { number: 9, state: "CLOSED", url: null, draft: false, review: "", checks: { total: 0, pending: 0, failed: 0 }, merge: "", method: "" }],
	]);
	assert.equal(pullRequestsFromGraph("nope", ["me/x"]), null);
});
