/**
 * The environment a terminal's shell is given: the server's own, which is
 * the login shell's plus the app's GitHub sign-in (electron/credentials.js),
 * less what is only for the server.
 *
 * The shell (electron/main.js) starts the server with ELECTRON_RUN_AS_NODE
 * and the address to listen on. A shell that inherited the first would run
 * every `node` typed in it as Electron, and the rest would leak a server's
 * settings into `npm run dev` typed there. GIT_TERMINAL_PROMPT=0 is right
 * for the agent's git, which has nobody to answer a prompt, and wrong for a
 * person's, who does. Pure, so it is tested on its own.
 */

const SERVER_ONLY = ["ELECTRON_RUN_AS_NODE", "PORT", "HOST", "CLIENT_DIR", "WORKDIR", "IDLE_MS", "APP_DIR", "GIT_TERMINAL_PROMPT"];

export function shellEnvFor(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(env)) if (!SERVER_ONLY.includes(key) && value !== undefined) out[key] = value;
	// What a terminal tells the programs in it: this one draws 256 colours
	// and true colour, and its text is UTF-8 — the last only where the login
	// shell did not already say.
	out.TERM = "xterm-256color";
	out.COLORTERM = "truecolor";
	if (!out.LANG && !out.LC_ALL) out.LANG = "en_US.UTF-8";
	return out;
}
