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
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { folderMeta } from "./folderMeta.ts";
import { startLogging } from "./log.ts";
import { idleFolders } from "./idle.ts";
import { text } from "./request.ts";
import { readSettings } from "./settings.ts";
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
const CWD = resolve(process.env.WORKDIR ?? process.cwd());
if (!existsSync(CWD)) {
	console.error(`working folder does not exist: ${CWD}`);
	process.exit(1);
}

/**
 * The folders this process may work in: the one it was started for, and
 * any the shell names over the channel afterwards (`{ workspace }`) — one
 * process serves every workspace now, and which folders those are is the
 * shell's to say, as it was when it started a process for each. A folder
 * asked for by a page and not on this list is refused. With no shell there
 * is only the one.
 */
const allowed = new Set<string>([CWD]);
const permitted = (folder: string | null | undefined): string | null => {
	if (!folder) return CWD;
	const full = resolve(folder);
	return allowed.has(full) ? full : null;
};

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
process.on("message", (message: unknown) => {
	if (typeof message !== "object" || message === null) return;
	const { workspace, warm, dispose } = message as { workspace?: unknown; warm?: unknown; dispose?: unknown };
	if (typeof workspace === "string") allowed.add(resolve(workspace));
	// Made ahead of being looked at, as the pointer rests on its row (main.js).
	if (typeof warm === "string") void open(warm)?.catch(() => {});
	if (typeof dispose === "string") void letGo(resolve(dispose));
});

/**
 * The built page, served by the process rather than the folder: it is the
 * same page for every folder, and it is wanted before the folder is ready —
 * the window is pointed here the moment the port answers, and the page is
 * what it draws while the workspace below is still being made.
 */
async function page(pathname: string, res: ServerResponse, folder: string): Promise<void> {
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
	res.end(pathname === "/" ? folderMeta(body.toString("utf8"), folder) : body);
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
/** The folder's module, loaded once and after the port is open — see `open`. */
const module = import("./workspace.ts");
/** Each permitted folder's workspace, from the moment one is asked for. */
const folders = new Map<string, Promise<Workspace>>();
/** The ones that are there, for what every folder is told at once. */
const made = new Map<string, Workspace>();

/**
 * The folder's workspace, made the first time it is asked for and kept:
 * one process serves every workspace, and a folder's is made behind the
 * page rather than before it. Most of a second went by between this
 * process starting and its first folder being ready — the agent's code
 * alone takes that long to load, once — and a window that waited for it
 * saw nothing meanwhile; now it sees the page, and the state arrives when
 * there is state. Null for a folder this process may not work in. A folder
 * that cannot be made is not kept, and the next ask tries again; the first
 * folder failing ends the process the way it always did, with the reason
 * as its last words.
 */
function open(folder: string | null | undefined): Promise<Workspace> | null {
	const full = permitted(folder);
	if (full === null) return null;
	const had = folders.get(full);
	if (had) return had;
	const making = module
		.then((m) => m.createWorkspace(full))
		.then((workspace) => {
			made.set(full, workspace);
			const { model, thinking, sessionFile } = workspace.status();
			console.log(`${full}: model: ${model}  thinking: ${thinking}`);
			console.log(`${full}: session: ${sessionFile ?? "(not persisted)"}`);
			return workspace;
		});
	folders.set(full, making);
	making.catch((err) => {
		folders.delete(full);
		console.error(err instanceof Error ? (err.stack ?? err.message) : err);
		if (full === CWD) process.exit(1);
	});
	return making;
}
void open(CWD);

/** A folder let go of — its watcher, its session, its tabs — because the shell is removing it. The next ask would make it anew. */
async function letGo(full: string, { asked = true } = {}): Promise<void> {
	const had = folders.get(full);
	folders.delete(full);
	made.delete(full);
	if (had) await (await had.catch(() => null))?.dispose();
	// Said when the shell asked: it waits on this before removing the folder.
	if (asked && process.connected) process.send?.({ disposed: full });
}

/**
 * A folder nobody is using and nothing is doing is let go of after this
 * long — its session, its watcher, its indexes — and made again the next
 * time a page asks for it, which takes a few milliseconds and not the
 * second the process took to start. Every folder opened would otherwise
 * stay for as long as the app runs, and a day of moving between twenty of
 * them would keep twenty. The rule is idle.ts's; this is the clock.
 */
const IDLE_MS = Number(process.env.IDLE_MS ?? 30 * 60_000);
setInterval(() => {
	for (const folder of idleFolders([...made].map(([full, workspace]) => [full, workspace.idleness()]), { now: Date.now(), idleMs: IDLE_MS })) {
		console.log(`${folder}: let go of, nobody having looked for a while`);
		void letGo(folder, { asked: false });
	}
}, Math.min(60_000, IDLE_MS)).unref();

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	const { pathname } = url;
	const json = (code: number, body: unknown) => {
		res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
		res.end(JSON.stringify(body));
	};
	// The settings are the process's, and every folder's tabs hear a change.
	if (pathname === "/api/settings") {
		if (req.method === "GET") return json(200, readSettings());
		if (req.method !== "POST") return json(405, { error: "read only" });
		let patch: unknown;
		try {
			patch = JSON.parse(await text(req));
		} catch {
			return json(400, { error: "invalid JSON" });
		}
		if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return json(400, { error: "expected an object" });
		const { writeSettings } = await module;
		let written;
		try {
			written = writeSettings(patch as Record<string, unknown>);
		} catch (err) {
			console.error("could not write settings:", err instanceof Error ? err.message : err);
			return json(500, { error: "could not write settings" });
		}
		json(200, written);
		// Every tab hears of it, the one that asked too: a settings screen open
		// in another window would otherwise build its next edit on the old
		// value, and the loadout is drawn on the composer, which hears about it
		// on the socket rather than by asking.
		for (const workspace of made.values()) workspace.settingsChanged(written);
		return;
	}
	// A folder's: which one, the page says (`?folder`), or it is the first.
	const folder = url.searchParams.get("folder");
	if (pathname.startsWith("/api/") || pathname.startsWith("/vault/")) {
		const workspace = open(folder);
		if (!workspace) return json(404, { error: "no such workspace" });
		return (await workspace).handle(req, res);
	}
	const full = permitted(folder);
	if (full === null) {
		res.writeHead(404).end("No such workspace");
		return;
	}
	return page(pathname, res, full);
});

/**
 * Two kinds of socket, told apart by path: `/ws` is a tab's, JSON both
 * ways (workspace.ts attach); `/pty` is a terminal's screen, bytes both
 * ways (pty/terminal.ts). Neither listens on the http server itself, so
 * the upgrade is routed here, once.
 */
const wss = new WebSocketServer({ noServer: true });
const ptys = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
	const { pathname } = new URL(req.url ?? "/", "http://localhost");
	const target = pathname === "/pty" ? ptys : wss;
	target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

/**
 * A socket given to its folder — named on the socket's address, or the
 * first — once there is one. What it sends meanwhile — the note its editor
 * has open, typing on the way out — is kept in order and given to the
 * folder's own listener the moment that is registered, which the folder
 * does before its first await. A folder this process may not work in is
 * closed on, with the code for it.
 */
function whenReady(ws: WebSocket, req: IncomingMessage, use: (ready: Workspace, url: URL) => void): void {
	const url = new URL(req.url ?? "/", "http://localhost");
	const workspace = open(url.searchParams.get("folder"));
	if (!workspace) return ws.close(1008, "no such workspace");
	const early: [unknown, boolean][] = [];
	const hold = (data: unknown, isBinary: boolean) => early.push([data, isBinary]);
	ws.on("message", hold);
	void workspace.then(
		(ready) => {
			if (ws.readyState !== ws.OPEN) return;
			use(ready, url);
			ws.off("message", hold);
			for (const [data, isBinary] of early) ws.emit("message", data, isBinary);
		},
		() => ws.close(1011, "the workspace could not be made"),
	);
}
wss.on("connection", (ws: WebSocket, req: IncomingMessage) => whenReady(ws, req, (ready) => void ready.attach(ws)));
ptys.on("connection", (ws: WebSocket, req: IncomingMessage) => whenReady(ws, req, (ready, url) => ready.terminal(url.searchParams.get("id") || "1", ws)));

server.listen(PORT, HOST, () => {
	console.log(`open http://localhost:${PORT}  (ctrl+c to stop)`);
	if (HOST !== "127.0.0.1") console.log(`listening on ${HOST} — anyone who can reach it controls this machine`);
	console.log(`log: ${logFile}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	// The folders there are, let go of; one still being made is not waited
	// for — nothing of it is on disk yet that its disposal would settle, and
	// a stop that waited on the agent's code loading would be a slow stop
	// for nothing.
	await Promise.all([...made.values()].map((workspace) => workspace.dispose()));
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
		for (const workspace of made.values()) workspace.broadcast({ type: "error", message: `${what}: ${err instanceof Error ? err.message : String(err)}` });
	} catch {
		// A socket that cannot be written to is not news at this point.
	}
}
process.on("uncaughtException", (err) => unhandled("uncaught error", err));
process.on("unhandledRejection", (reason) => unhandled("unhandled rejection", reason));

