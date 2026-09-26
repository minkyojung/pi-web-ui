/**
 * GitHub, by way of the person's own `gh`.
 *
 * Conductor reaches GitHub the same way: the sign-in is the one the person
 * already made in their terminal, so the app holds no token and registers no
 * app of its own. Everything else works without it — opening a repository,
 * making a workspace, fetching are git's. When a sign-in of the app's own is
 * wanted (OAuth, as Cursor has it), it goes in here and nowhere else.
 */
import { execFile } from "node:child_process";

import { gitEnv } from "./credentials.js";

/** gh's answer, trimmed, or null when there is no gh, no sign-in, or no answer. */
function gh(args, { timeoutMs = 15_000, cwd } = {}) {
	return new Promise((resolve) => {
		execFile("gh", args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: "1" }, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
			resolve(err ? null : String(stdout).trim() || null);
		});
	});
}

/**
 * The signed-in person as GitHub's answer to `gh api user` has them, cut to
 * what the app shows — or null for anything that is not that answer. Only
 * the public profile: `email` is the one they chose to show, not their
 * others (emails). What they have not filled in is null rather than made up
 * — a person with no name has none, and the page decides what stands in for
 * it. Pure, so it can be read in a test.
 */
export function profileFrom(out) {
	let user;
	try {
		user = JSON.parse(out);
	} catch {
		return null;
	}
	if (!user || typeof user !== "object" || typeof user.login !== "string" || !user.login) return null;
	const name = typeof user.name === "string" ? user.name.trim() : "";
	return {
		login: user.login,
		name: name || null,
		avatarUrl: typeof user.avatar_url === "string" && user.avatar_url.startsWith("https://") ? user.avatar_url : null,
		url: `https://github.com/${user.login}`,
		id: Number.isInteger(user.id) && user.id > 0 ? user.id : null,
		email: typeof user.email === "string" && /^[^\s@<>]+@[^\s@<>]+$/.test(user.email) ? user.email : null,
	};
}

/**
 * The person's email addresses as GitHub's list has them (`gh api
 * user/emails`) — the verified ones, since GitHub ties a commit to no other
 * — or null for anything that is not that list. Pure.
 */
export function emailsFrom(out) {
	let list;
	try {
		list = JSON.parse(out);
	} catch {
		return null;
	}
	if (!Array.isArray(list)) return null;
	return list
		.filter((entry) => entry && typeof entry.email === "string" && entry.verified === true)
		.map((entry) => ({ email: entry.email, primary: entry.primary === true, visibility: typeof entry.visibility === "string" ? entry.visibility : null }));
}

/**
 * The signed-in person's email addresses, or null when gh cannot say — and
 * it cannot until the sign-in has been let read them (the user:email scope;
 * allowEmail): GitHub answers 404 without it.
 */
export async function emails() {
	return emailsFrom(await gh(["api", "user/emails"]));
}

/**
 * The address to offer a person to commit as, as GitHub Desktop picks it
 * (lookupPreferredEmail in desktop/desktop's app/src/lib/email.ts): the
 * primary if it is public — a list without visibility is an older GitHub's,
 * where every address was — else a noreply one on the list, else the first
 * on it, else the noreply address made from their number. Without the list
 * the profile's public email stands in for a public primary. Null when
 * there is nothing to make one from. Pure.
 */
export function preferredEmail(profile, list) {
	const made = noreplyEmail(profile.id, profile.login);
	if (!list) return profile.email ?? made;
	if (list.length === 0) return made;
	const primary = list.find((entry) => entry.primary);
	if (primary && (primary.visibility === "public" || primary.visibility === null)) return primary.email;
	return list.find((entry) => entry.email.toLowerCase().endsWith("@users.noreply.github.com"))?.email ?? list[0].email;
}

/**
 * The address GitHub keeps for a person to commit as without giving their
 * own: their number and their login at users.noreply.github.com. GitHub ties
 * a commit made as it to them, and it stays theirs when the login changes —
 * the number is why — so it is null without the number.
 */
export function noreplyEmail(id, login) {
	return Number.isInteger(id) && id > 0 && login ? `${id}+${login}@users.noreply.github.com` : null;
}

/** The signed-in person on GitHub, or null: no gh, no sign-in, no answer. */
async function profile() {
	return profileFrom(await gh(["api", "user"]));
}

/** The signed-in person's GitHub name, which starts their branch names — or null. */
export async function login() {
	return (await profile())?.login ?? null;
}

/**
 * Where the person stands with GitHub, for Settings: `missing` when there is
 * no gh to ask, `signed-out` when it has no one — or its keyring is locked,
 * which it cannot tell from no one — and `signed-in` with who they are.
 */
export async function standing() {
	if ((await gh(["--version"])) === null) return { state: "missing" };
	const person = await profile();
	return person ? { state: "signed-in", ...person } : { state: "signed-out" };
}

/**
 * What gh says on its way in, read for the page: the one-time code and the
 * address to enter it at, each once it appears. gh writes both to stderr —
 * `! First copy your one-time code: ABCD-1234` and `Open this URL to
 * continue in your web browser: https://github.com/login/device` — and,
 * with no terminal to wait on, goes straight to polling for the approval.
 */
export function deviceCodeFrom(text) {
	const code = /one-time code[ :(]+([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(text)?.[1] ?? null;
	const url = /(https:\/\/\S+\/login\/device\S*)/.exec(text)?.[1] ?? null;
	return code && url ? { userCode: code, verificationUri: url } : null;
}

/**
 * Sign in to github.com with gh, as `gh auth login --web` does in a terminal
 * but with none: gh gets a code from GitHub and says it, `onCode` shows it,
 * the person enters it in their browser, and gh waits for GitHub to say so
 * and keeps the token in its own keyring — where `credentials.js` finds it
 * from then on, for the app and for the terminal alike. Resolves `{ ok }`
 * when gh ends well, `{ error }` with gh's own words when not, and
 * `{ cancelled }` when `signal` gave up — the person's own doing, not news.
 */
export function signIn({ onCode, signal }) {
	return new Promise((resolve) => {
		const args = ["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--skip-ssh-key"];
		const child = execFile("gh", args, { env: { ...process.env, GH_PROMPT_DISABLED: "1" }, timeout: 15 * 60_000, signal }, (err, _stdout, stderr) => {
			if (!err) resolve({ ok: true });
			else if (err.name === "AbortError") resolve({ cancelled: true });
			else resolve({ error: String(stderr).replace(/^[!✓]\s*/gm, "").trim() || err.message });
		});
		child.stdin?.end();
		let said = "";
		let told = false;
		child.stderr?.on("data", (chunk) => {
			if (told) return;
			said += chunk;
			const code = deviceCodeFrom(said);
			if (code) {
				told = true;
				onCode(code);
			}
		});
	});
}

/** Sign out of github.com in gh: the token goes from its keyring, and so from the app. */
export async function signOut() {
	return (await gh(["auth", "logout", "--hostname", "github.com"])) === null ? { error: "gh could not sign out." } : { ok: true };
}

/**
 * The signed-in person's repositories, most recently pushed first, or null
 * when gh cannot say — not installed, or not signed in.
 */
export async function repositories() {
	const out = await gh(["repo", "list", "--limit", "200", "--json", "nameWithOwner,description,isPrivate,pushedAt"], { timeoutMs: 30_000 });
	if (out === null) return null;
	try {
		const list = JSON.parse(out);
		if (!Array.isArray(list)) return null;
		return list
			.filter((repo) => repo && typeof repo.nameWithOwner === "string")
			.sort((a, b) => String(b.pushedAt ?? "").localeCompare(String(a.pushedAt ?? "")))
			.map((repo) => ({ name: repo.nameWithOwner, description: typeof repo.description === "string" ? repo.description : "", private: repo.isPrivate === true }));
	} catch {
		return null;
	}
}

/**
 * What a clone is asked for with — `owner/name`, or a GitHub address as the
 * page gives it or as git writes it — as the name its folder takes, or null
 * for anything else. Only GitHub: gh is what reaches it, and a git address of
 * any other host is a URL git would have to be trusted with blind.
 */
export function repositoryName(source) {
	const text = String(source ?? "").trim();
	const match =
		/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(text) ??
		/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(text) ??
		/^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(text);
	if (!match || match[2] === "." || match[2] === "..") return null;
	return { owner: match[1], name: match[2] };
}

/**
 * Clone `owner/name` into `into`: with gh when someone is signed in to it,
 * which clones a private repository as them without asking; else with git
 * over https, which clones a public one. Git's or gh's own words when it
 * fails.
 */
export async function clone({ owner, name }, into) {
	const [command, args] = (await login())
		? ["gh", ["repo", "clone", `${owner}/${name}`, into]]
		: ["git", ["clone", `https://github.com/${owner}/${name}.git`, into]];
	const env = { ...process.env, ...(await gitEnv()), GH_PROMPT_DISABLED: "1" };
	await new Promise((resolve, reject) => {
		execFile(command, args, { env, timeout: 10 * 60_000 }, (err, _stdout, stderr) => {
			if (err) reject(new Error(String(stderr).trim() || err.message));
			else resolve();
		});
	});
}

/** gh's list of issues as the dialog takes them — number, title, body — or null for anything that is not such a list. */
export function issuesFrom(out) {
	try {
		const list = JSON.parse(out);
		if (!Array.isArray(list)) return null;
		return list
			.filter((issue) => issue && Number.isInteger(issue.number) && typeof issue.title === "string")
			.map((issue) => ({ number: issue.number, title: issue.title, body: typeof issue.body === "string" ? issue.body : "" }));
	} catch {
		return null;
	}
}

/**
 * The open issues of the repository cloned at `root`, the latest first as gh
 * gives them, for a spec to be started from one — or null when gh cannot
 * say: not installed, not signed in, or the clone is not of a GitHub
 * repository. Asked from inside the clone, so gh reads which repository off
 * its remote as it does in a terminal.
 */
export async function issues(root) {
	const out = await gh(["issue", "list", "--state", "open", "--limit", "100", "--json", "number,title,body"], { cwd: root, timeoutMs: 30_000 });
	return out === null ? null : issuesFrom(out);
}

/** gh's flag for each of GitHub's ways to merge (viewerDefaultMergeMethod). */
const MERGE_FLAGS = { MERGE: "--merge", SQUASH: "--squash", REBASE: "--rebase" };

/** What gh is given to merge pull request `number` the way `method` says, or null for a number or a way that is not one. Pure. */
export function mergeArgs(number, method) {
	const flag = MERGE_FLAGS[method];
	return Number.isInteger(number) && number > 0 && flag ? ["pr", "merge", String(number), flag] : null;
}

/**
 * Pull request `number` merged, asked from inside the workspace at `cwd` so gh
 * reads the repository off its remote — `{}` when GitHub took it, `{ error }`
 * with gh's own first line when it did not: a check the repository requires,
 * a review, a conflict come to since. Not `--delete-branch`: that is the
 * repository's own setting, and with it gh would switch this folder off its
 * branch. The way it merges is the repository's default, which the page was
 * told with the pull request.
 */
export function mergePullRequest(cwd, number, method) {
	const args = mergeArgs(number, method);
	if (!args) return Promise.resolve({ error: "Not a pull request, or not a way GitHub merges." });
	return new Promise((resolve) => {
		execFile("gh", args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: "1" }, timeout: 60_000 }, (err, _stdout, stderr) => {
			if (!err) return resolve({});
			const said = String(stderr ?? "").split("\n").map((line) => line.trim()).find(Boolean);
			resolve({ error: said || (err.code === "ENOENT" ? "gh is not installed." : "GitHub did not merge it.") });
		});
	});
}

/** How a commit's checks stand, from the rollup's contexts as GitHub gives them: a check run by its status and conclusion, a status by its state. */
function checksOf(contexts) {
	const checks = { total: contexts.length, pending: 0, failed: 0 };
	for (const check of contexts) {
		const state = String(check?.conclusion || check?.state || "").toUpperCase();
		if (["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED"].includes(state) && String(check?.status || "").toUpperCase() !== "COMPLETED") checks.pending++;
		else if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(state)) checks.failed++;
	}
	return checks;
}

/**
 * One GraphQL query for the pull requests of exactly these branches — each
 * its latest — with the checks of its last commit, rather than the
 * repository's every pull request listed and the few wanted picked out:
 * the listing was two seconds, nearly all of it pull requests nobody here
 * is on. Conductor asks GitHub the same way. Pure, so what is asked can be
 * read in a test.
 */
export function pullRequestsQuery(branches) {
	const refs = branches
		.map((branch, i) => `b${i}: ref(qualifiedName: ${JSON.stringify(`refs/heads/${branch}`)}) { ...pr }`)
		.join("\n    ");
	return `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    viewerDefaultMergeMethod
    ${refs}
  }
}
fragment pr on Ref {
  associatedPullRequests(first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) {
    nodes {
      number state url isDraft reviewDecision headRefName mergeStateStatus
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { ... on CheckRun { status conclusion } ... on StatusContext { state } } } } } } }
    }
  }
}`;
}

/**
 * GitHub's answer to pullRequestsQuery as the list takes it — by head
 * branch, each branch's latest pull request — or null for anything that is
 * not that answer. A branch GitHub does not have, or has no pull request
 * for, is simply not in it.
 *
 * `merge` is GitHub's own one word on whether the pull request can be
 * merged, and if not what stands in the way (mergeStateStatus): CLEAN,
 * BLOCKED for a review or a check it requires, BEHIND the base when the
 * base must be merged in first, DIRTY for conflicts, UNSTABLE for a check
 * that failed and is not required, DRAFT, HAS_HOOKS, and UNKNOWN while
 * GitHub is still working it out. Taken as GitHub says it rather than
 * worked out again here from the checks and reviews: it knows which of
 * them the repository requires, and this does not.
 */
export function pullRequestsFromGraph(out, branches) {
	try {
		const repository = JSON.parse(out)?.data?.repository;
		if (!repository || typeof repository !== "object") return null;
		const byHead = new Map();
		// The repository's, and the same for every pull request of it: how
		// Merge merges — its default, rather than a setting of the app's.
		const method = ["MERGE", "SQUASH", "REBASE"].includes(repository.viewerDefaultMergeMethod) ? repository.viewerDefaultMergeMethod : "";
		branches.forEach((branch, i) => {
			const pr = repository[`b${i}`]?.associatedPullRequests?.nodes?.[0];
			if (!pr || !Number.isInteger(pr.number) || typeof pr.state !== "string") return;
			const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes;
			byHead.set(branch, {
				number: pr.number,
				state: pr.state,
				url: typeof pr.url === "string" ? pr.url : null,
				draft: pr.isDraft === true,
				review: typeof pr.reviewDecision === "string" ? pr.reviewDecision : "",
				checks: checksOf(Array.isArray(contexts) ? contexts : []),
				merge: typeof pr.mergeStateStatus === "string" ? pr.mergeStateStatus : "",
				method,
			});
		});
		return byHead;
	} catch {
		return null;
	}
}

/**
 * The pull requests of these branches of the repository cloned at `root`,
 * each its latest, by branch — or null when gh cannot say. One call for
 * every workspace of the repository; gh reads which repository off the
 * clone's remote, as it does in a terminal.
 */
export async function pullRequests(root, branches) {
	if (branches.length === 0) return new Map();
	const out = await gh(["api", "graphql", "-F", "owner={owner}", "-F", "repo={repo}", "-f", `query=${pullRequestsQuery(branches)}`], { cwd: root, timeoutMs: 30_000 });
	return out === null ? null : pullRequestsFromGraph(out, branches);
}
