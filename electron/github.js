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

/** gh's answer, trimmed, or null when there is no gh, no sign-in, or no answer. */
function gh(args, { timeoutMs = 15_000 } = {}) {
	return new Promise((resolve) => {
		execFile("gh", args, { env: { ...process.env, GH_PROMPT_DISABLED: "1" }, timeout: timeoutMs }, (err, stdout) => {
			resolve(err ? null : String(stdout).trim() || null);
		});
	});
}

/** The signed-in person's GitHub name, which starts their branch names — or null. */
export function login() {
	return gh(["api", "user", "--jq", ".login"]);
}
