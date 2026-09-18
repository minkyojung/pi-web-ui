/**
 * The environment a terminal would have.
 *
 * An app opened from the Finder or the Dock is started by launchd with a bare
 * PATH — /usr/bin:/bin:/usr/sbin:/sbin — and none of what the person's shell
 * profile adds: Homebrew, nvm, their gh and node and npm. A coding agent that
 * runs `npm test`, and a shell that clones with gh, need exactly those. So the
 * environment is asked of the person's own login shell, once, at start — the
 * way VS Code does it (resolveShellEnv): the shell runs this same binary as
 * node, which prints the environment it was given as JSON between two marks,
 * and whatever the profile prints on its own way in is left outside them.
 *
 * Nothing here is load-bearing for starting: a shell that fails, or takes
 * longer than a profile has any business taking, leaves the environment the
 * app was started with.
 */
import { execFile } from "node:child_process";

const MARK = "__OCTAVE_SHELL_ENV__";

/** What the app itself sets to run as node, which the rest of it must not inherit. */
const OURS = ["ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE"];

/** A string as one shell word. */
const quoted = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The environment printed between the marks, or null if there is none to read. */
export function envFrom(output) {
	const start = output.indexOf(MARK);
	const end = output.lastIndexOf(MARK);
	if (start === -1 || end <= start) return null;
	try {
		const env = JSON.parse(output.slice(start + MARK.length, end));
		if (!env || typeof env !== "object" || Array.isArray(env)) return null;
		for (const key of OURS) delete env[key];
		return env;
	} catch {
		return null;
	}
}

/**
 * The login shell's environment, or null. `shell` is the person's ($SHELL);
 * `node` is a binary that runs as node when ELECTRON_RUN_AS_NODE says so —
 * the app's own.
 */
export function shellEnv({ shell, node, timeoutMs = 10_000 }) {
	const print = `${quoted(node)} -p ${quoted(`"${MARK}" + JSON.stringify(process.env) + "${MARK}"`)}`;
	return new Promise((resolve) => {
		execFile(
			shell,
			["-i", "-l", "-c", print],
			{ env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ATTACH_CONSOLE: "1" }, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
			(err, stdout) => {
				if (err && !stdout) return resolve(null);
				resolve(envFrom(String(stdout)));
			},
		);
	});
}
