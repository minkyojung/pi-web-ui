/**
 * A web UI over one pi coding-agent session.
 *
 * Serves the built client from dist/, owns an AgentSessionRuntime, and forwards
 * every session event to connected browsers as raw JSON. The browser holds no
 * state of its own: config, usage, sessions, and snapshot messages describe the
 * server's state and are rebroadcast whenever it changes.
 */

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { startLogging } from "./log.ts";
import { takeCredentials } from "./standing.ts";
import { createWorkspace } from "./workspace.ts";

/**
 * What this process says, to a file as well as to the terminal — see log.ts.
 * First, so that what follows is in it. What it cannot catch is a line printed
 * while another module was being loaded, since those run before this body
 * does; in practice that is pi's own extensions announcing themselves.
 */
const logFile = startLogging();

const PORT = Number(process.env.PORT ?? 3000);
/**
 * Loopback by default. There is no authentication here and the agent runs shell
 * commands with this process's permissions, so anything that can reach the port
 * has the machine. Binding every interface — which is what listen() does when
 * you leave the host out — hands that to whoever else is on the wifi. Set
 * HOST=0.0.0.0 to expose it on purpose.
 */
const HOST = process.env.HOST ?? "127.0.0.1";
/**
 * Where the agent reads and writes. Inherited from the shell when this is run
 * from a terminal, which is what you want there; the desktop app has no useful
 * working directory of its own, so it asks and passes the answer in.
 */
const CWD = process.env.WORKDIR ?? process.cwd();
if (!existsSync(CWD)) {
	console.error(`working folder does not exist: ${CWD}`);
	process.exit(1);
}

process.on("message", takeCredentials);

const workspace = await createWorkspace(CWD);

const server = createServer((req, res) => void workspace.handle(req, res));

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => void workspace.attach(ws));

server.listen(PORT, HOST, () => {
	console.log(`open http://localhost:${PORT}  (ctrl+c to stop)`);
	if (HOST !== "127.0.0.1") console.log(`listening on ${HOST} — anyone who can reach it controls this machine`);
	const { model, thinking, sessionFile } = workspace.status();
	console.log(`model: ${model}  thinking: ${thinking}`);
	console.log(`session: ${sessionFile ?? "(not persisted)"}`);
	console.log(`log: ${logFile}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	await workspace.dispose();
	server.close(() => process.exit(0));
}

// Being asked to stop comes in two words, and only one of them is Ctrl+C. The
// desktop shell asks the other way — child.kill() sends SIGTERM — and with no
// listener for it the default action is to go at once, so everything above
// this line was the path that only a terminal ever took. ⌘Q never retired an
// extension or disposed a session.
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/**
 * Whatever was not caught nearer to where it happened.
 *
 * A message from a tab is handled inside a try/catch that answers the tab.
 * Everything else here is not: the watcher's callback, pi's event
 * subscription, an extension, a timer. An error in one of those used to take
 * the process with it, and the desktop shell reports a server that stopped by
 * quitting — mid-answer, with the session's own last words gone.
 *
 * So it is said instead, in both directions: to the terminal with its stack,
 * and to the tabs, which are otherwise left watching a spinner that will not
 * move. And the server stays up, because nothing it holds is the only copy of
 * anything — the notes are files, the log is a file, the session is pi's own
 * file. Staying up with one thing broken is worth more here than a clean exit
 * that takes the other three columns with it.
 */
function unhandled(what: string, err: unknown): void {
	console.error(`[${what}]`, err instanceof Error ? (err.stack ?? err.message) : err);
	if (shuttingDown) return;
	// The report must not become the next uncaught error.
	try {
		workspace.broadcast({ type: "error", message: `${what}: ${err instanceof Error ? err.message : String(err)}` });
	} catch {
		// A socket that cannot be written to is not news at this point.
	}
}
process.on("uncaughtException", (err) => unhandled("uncaught error", err));
process.on("unhandledRejection", (reason) => unhandled("unhandled rejection", reason));

