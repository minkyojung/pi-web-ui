/**
 * GitHub credentials, handed to git rather than left for it to find.
 *
 * An app started from the Dock has no terminal, so a git that wants a
 * password has nowhere to ask — and the agent's git is a child of the app's
 * server, which is a child of the app. What the person signed in to with gh
 * in their terminal reaches neither unless the app carries it down. So it
 * does, the way VS Code, GitHub Desktop and Conductor carry theirs: not by
 * writing the person's git configuration, but in the environment of each
 * process that runs git.
 *
 * The two lines are the ones `gh auth setup-git` writes to the global config
 * — a blank helper for github.com, which cuts off whatever helpers come
 * before it for that host and no other, then one that answers with the
 * token. Given per process, they leave GitLab and a company's git to the
 * helpers the person has for them, and leave everything as it was when there
 * is no token to give.
 */
import { execFile } from "node:child_process";

/** How long a token found — or not found — stands before gh is asked again. */
const TTL_MS = 60_000;
let known = { at: 0, token: null };

/**
 * The person's GitHub token: GH_TOKEN if the shell set it, else what gh is
 * signed in with, else null — gh not installed, not signed in, or its
 * keyring locked. Asked at most once a minute, since every git the app runs
 * asks.
 */
export function token() {
	if (process.env.GH_TOKEN) return Promise.resolve(process.env.GH_TOKEN);
	if (Date.now() - known.at < TTL_MS) return Promise.resolve(known.token);
	return new Promise((resolve) => {
		execFile("gh", ["auth", "token"], { env: { ...process.env, GH_PROMPT_DISABLED: "1" }, timeout: 15_000 }, (err, stdout) => {
			const found = err ? null : String(stdout).trim() || null;
			known = { at: Date.now(), token: found };
			resolve(found);
		});
	});
}

/**
 * The environment git runs in, given a token or null: never a prompt, and
 * with a token, the token — for gh, and for git by way of a helper that
 * answers with it for github.com.
 */
export function gitEnvFor(token) {
	if (!token) return { GIT_TERMINAL_PROMPT: "0" };
	return {
		GIT_TERMINAL_PROMPT: "0",
		GH_TOKEN: token,
		GIT_CONFIG_COUNT: "2",
		GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
		GIT_CONFIG_VALUE_0: "",
		GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
		GIT_CONFIG_VALUE_1: `!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$GH_TOKEN"; }; f`,
	};
}

/** `gitEnvFor` the token there is now. */
export const gitEnv = async () => gitEnvFor(await token());
