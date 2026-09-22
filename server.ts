/**
 * A web UI over one pi coding-agent session.
 *
 * Serves the built client from dist/, owns an AgentSessionRuntime, and forwards
 * every session event to connected browsers as raw JSON. The browser holds no
 * state of its own: config, usage, sessions, and snapshot messages describe the
 * server's state and are rebroadcast whenever it changes.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { folderMeta } from "./folderMeta.ts";
import { startLogging } from "./log.ts";
import { takeCredentials } from "./standing.ts";

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

const CLIENT_DIR = process.env.CLIENT_DIR
	? pathToFileURL(process.env.CLIENT_DIR.replace(/\/?$/, "/"))
	: new URL("dist/", import.meta.url);

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	// pdf.js's worker is built as a module under this name, and a browser runs
	// a module only when it is served as JavaScript: as bytes the PDF tab says
	// the file could not be shown — in the built app alone, since vite serves
	// its own while developing.
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".map": "application/json; charset=utf-8",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
};

process.on("message", takeCredentials);

/**
 * The built page, served by the process rather than the folder: it is the
 * same page for every folder, and it is wanted before the folder is ready —
 * the window is pointed here the moment the port answers, and the page is
 * what it draws while the workspace below is still being made.
 */
async function page(pathname: string, res: ServerResponse): Promise<void> {
	// The build hashes its asset names, so the set of files cannot be listed
	// ahead of time the way the two hand-written ones could be.
	const file = new URL(pathname === "/" ? "index.html" : pathname.slice(1), CLIENT_DIR);
	// A path can climb out of dist/ with ..; resolving first and comparing after
	// is the only check that survives whatever encoding it arrives in.
	if (!file.pathname.startsWith(CLIENT_DIR.pathname)) {
		res.writeHead(404).end("Not found");
		return;
	}
	let body: Buffer;
	try {
		body = await readFile(file);
	} catch {
		if (pathname === "/") console.error("no dist/ yet — run `npm run build`, or use the vite dev server");
		res.writeHead(404).end("Not found");
		return;
	}
	const ext = file.pathname.slice(file.pathname.lastIndexOf("."));
	res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
	// The page is told which folder it is a window on before any of it runs —
	// see web/src/workspace.ts for why a page cannot go by its address.
	res.end(pathname === "/" ? folderMeta(body.toString("utf8"), CWD) : body);
}

/**
 * The folder, made after the port is open rather than before. Most of a
 * second goes by between this process starting and its session being ready
 * — the agent's code alone takes that long to load — and a window that
 * waited for it saw nothing meanwhile. Now it sees the page, and the state
 * arrives when there is state: a request for the folder waits here, and a
 * tab that connects early is held, with what it said, until it can be
 * attached. A folder that cannot be made ends the process the way it always
 * did, with the reason as its last words.
 */
type Workspace = Awaited<ReturnType<typeof import("./workspace.ts").createWorkspace>>;
let workspace: Workspace | null = null;
const ready: Promise<Workspace> = import("./workspace.ts")
	.then((m) => m.createWorkspace(CWD))
	.then((made) => {
		workspace = made;
		const { model, thinking, sessionFile } = made.status();
		console.log(`model: ${model}  thinking: ${thinking}`);
		console.log(`session: ${sessionFile ?? "(not persisted)"}`);
		return made;
	});
ready.catch((err) => {
	console.error(err instanceof Error ? (err.stack ?? err.message) : err);
	process.exit(1);
});

const server = createServer(async (req, res) => {
	const { pathname } = new URL(req.url ?? "/", "http://localhost");
	if (pathname.startsWith("/api/") || pathname.startsWith("/vault/")) return (workspace ?? (await ready)).handle(req, res);
	return page(pathname, res);
});

const wss = new WebSocketServer({ server });

/**
 * A tab attached to the folder once there is one. What it sends meanwhile —
 * the note its editor has open, typing on the way out — is kept in order
 * and given to the folder's own listener the moment that is registered,
 * which attach() does before its first await.
 */
function attachWhenReady(ws: WebSocket): void {
	if (workspace) return void workspace.attach(ws);
	const early: Parameters<(data: unknown, isBinary: boolean) => void>[] = [];
	const hold = (data: unknown, isBinary: boolean) => early.push([data, isBinary]);
	ws.on("message", hold);
	void ready.then((made) => {
		if (ws.readyState !== ws.OPEN) return;
		void made.attach(ws);
		ws.off("message", hold);
		for (const [data, isBinary] of early) ws.emit("message", data, isBinary);
	});
}
wss.on("connection", attachWhenReady);

server.listen(PORT, HOST, () => {
	console.log(`open http://localhost:${PORT}  (ctrl+c to stop)`);
	if (HOST !== "127.0.0.1") console.log(`listening on ${HOST} — anyone who can reach it controls this machine`);
	console.log(`log: ${logFile}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	// A folder still being made is waited for, then let go; one that never
	// will be has already ended the process.
	await (workspace ?? (await ready.catch(() => null)))?.dispose();
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
		workspace?.broadcast({ type: "error", message: `${what}: ${err instanceof Error ? err.message : String(err)}` });
	} catch {
		// A socket that cannot be written to is not news at this point.
	}
}
process.on("uncaughtException", (err) => unhandled("uncaught error", err));
process.on("unhandledRejection", (reason) => unhandled("unhandled rejection", reason));

