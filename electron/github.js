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

/** The signed-in person's GitHub name, which starts their branch names — or null. */
export function login() {
	return gh(["api", "user", "--jq", ".login"]);
}

/**
 * Where the person stands with GitHub, for Settings › Accounts: `missing`
 * when there is no gh to ask, `signed-out` when it has no one — or its
 * keyring is locked, which it cannot tell from no one — and `signed-in` with
 * their name.
 */
export async function standing() {
	if ((await gh(["--version"])) === null) return { state: "missing" };
	const name = await login();
	return name ? { state: "signed-in", login: name } : { state: "signed-out" };
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
 * when gh ends well, `{ error }` with gh's own words when not; `signal`
 * gives up, which is an error too.
 */
export function signIn({ onCode, signal }) {
	return new Promise((resolve) => {
		const args = ["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--skip-ssh-key"];
		const child = execFile("gh", args, { env: { ...process.env, GH_PROMPT_DISABLED: "1" }, timeout: 15 * 60_000, signal }, (err, _stdout, stderr) => {
			if (!err) resolve({ ok: true });
			else resolve({ error: err.name === "AbortError" ? "Sign-in cancelled." : String(stderr).replace(/^[!✓]\s*/gm, "").trim() || err.message });
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

/** gh's list of pull requests as the list takes them — by head branch, the newest first — or null for anything that is not such a list. */
export function pullRequestsFrom(out) {
	try {
		const list = JSON.parse(out);
		if (!Array.isArray(list)) return null;
		const byHead = new Map();
		for (const pr of list) {
			if (!pr || !Number.isInteger(pr.number) || typeof pr.headRefName !== "string" || typeof pr.state !== "string") continue;
			if (byHead.has(pr.headRefName)) continue;
			// The checks, folded to what the foot of the window says of them:
			// gh gives each as a status (its own name for a check run) with a
			// conclusion, or as a commit status with a state.
			const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
			const checks = { total: rollup.length, pending: 0, failed: 0 };
			for (const check of rollup) {
				const state = String(check?.conclusion || check?.state || "").toUpperCase();
				if (["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED"].includes(state) && String(check?.status || "").toUpperCase() !== "COMPLETED") checks.pending++;
				else if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(state)) checks.failed++;
			}
			byHead.set(pr.headRefName, {
				number: pr.number,
				state: pr.state,
				url: typeof pr.url === "string" ? pr.url : null,
				draft: pr.isDraft === true,
				review: typeof pr.reviewDecision === "string" ? pr.reviewDecision : "",
				checks,
			});
		}
		return byHead;
	} catch {
		return null;
	}
}

/**
 * The repository's pull requests, open and closed, by the branch each is
 * from — the newest first, so a branch with several is known by its latest
 * — or null when gh cannot say. One call for every workspace of the
 * repository, since the list is drawn a row at a time.
 */
export async function pullRequests(root) {
	const out = await gh(["pr", "list", "--state", "all", "--limit", "200", "--json", "number,state,headRefName,url,isDraft,reviewDecision,statusCheckRollup"], { cwd: root, timeoutMs: 30_000 });
	return out === null ? null : pullRequestsFrom(out);
}
