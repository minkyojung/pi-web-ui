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
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type AgentSessionEvent,
	type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { itemsFromMessages } from "./conversation.js";

const PORT = Number(process.env.PORT ?? 3000);
/**
 * Loopback by default. There is no authentication here and the agent runs shell
 * commands with this process's permissions, so anything that can reach the port
 * has the machine. Binding every interface — which is what listen() does when
 * you leave the host out — hands that to whoever else is on the wifi. Set
 * HOST=0.0.0.0 to expose it on purpose.
 */
const HOST = process.env.HOST ?? "127.0.0.1";
/** "provider/id". Only the starting model; the UI can switch it live. */
const MODEL = process.env.MODEL ?? "openai/gpt-5.4";
/**
 * Where the agent reads and writes. Inherited from the shell when this is run
 * from a terminal, which is what you want there; the desktop app has no useful
 * working directory of its own, so it asks and passes the answer in.
 */
const CWD = process.env.WORKDIR ?? process.cwd();
if (!existsSync(CWD)) {
	console.error(`working directory does not exist: ${CWD}`);
	process.exit(1);
}

/**
 * JSON.stringify that survives circular references and Error values.
 *
 * Only the current ancestor path counts as "seen". Tracking every visited
 * object instead would collapse an object that merely appears twice in the
 * tree, which is a shape pi actually emits.
 */
function safeStringify(value: unknown): string {
	const ancestors: unknown[] = [];
	return JSON.stringify(
		value,
		function (this: unknown, _key, val) {
			if (val instanceof Error) return { name: val.name, message: val.message };
			if (typeof val === "bigint") return val.toString();
			if (typeof val !== "object" || val === null) return val;
			// `this` is the object val was read from, so unwinding to it leaves
			// exactly the path from the root to val on the stack.
			while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
			if (ancestors.includes(val)) return "[Circular]";
			ancestors.push(val);
			return val;
		},
		2,
	);
}

const modelRuntime = await ModelRuntime.create();

/** Models with usable credentials. Fixed for the process; auth does not change while running. */
const availableModels = await modelRuntime.getAvailable();
const modelKey = (m: { provider: string; id: string }) => `${m.provider}/${m.id}`;

if (availableModels.length === 0) {
	console.error("No model has usable credentials. Run `pi`, sign in with /login, then start this again.");
	process.exit(1);
}

const [provider, ...rest] = MODEL.split("/");
// getModel only says whether the name is in the catalogue, which is a different
// question from whether this machine can call it. A default that suits the
// person who built this is no use to whoever runs it with another provider's
// key, so an unusable name falls back rather than killing the process.
const requested = modelRuntime.getModel(provider, rest.join("/"));
const startingModel =
	requested && availableModels.some((m) => modelKey(m) === modelKey(requested)) ? requested : availableModels[0];
if (startingModel !== requested) console.warn(`${MODEL} is not available here; starting on ${modelKey(startingModel)}`);

/**
 * The runtime, not a bare session: /new and /resume replace the AgentSession
 * object, and only the runtime can do that. Everything below reads
 * runtime.session rather than capturing it.
 */
const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
	const services = await createAgentSessionServices({ cwd, modelRuntime });
	return {
		...(await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: startingModel,
		})),
		services,
		diagnostics: services.diagnostics,
	};
};

const runtime = await createAgentSessionRuntime(createRuntime, {
	cwd: CWD,
	agentDir: getAgentDir(),
	// Persisted to ~/.pi/agent/sessions/, so a session survives a restart.
	sessionManager: SessionManager.create(CWD),
});

const session = () => runtime.session;

/** Derived from the session so it stays in sync; pi does not re-export ThinkingLevel. */
type ThinkingLevel = ReturnType<typeof session>["thinkingLevel"];

/** Everything the settings UI needs. Re-sent whenever any of it changes. */
function config() {
	const s = session();
	const model = s.model;
	return {
		type: "config",
		model: model ? modelKey(model) : null,
		models: availableModels.map(modelKey),
		thinkingLevel: s.thinkingLevel,
		thinkingLevels: s.supportsThinking() ? s.getAvailableThinkingLevels() : [],
		tools: s.getAllTools().map((tool) => ({ name: tool.name, description: tool.description })),
		activeTools: s.getActiveToolNames(),
		isStreaming: s.isStreaming,
		queued: {
			steering: [...s.getSteeringMessages()],
			followUp: [...s.getFollowUpMessages()],
		},
		sessionId: s.sessionId,
		sessionName: s.sessionName ?? null,
	};
}

/**
 * Token spend and context pressure. pi tracks both; without surfacing them the
 * user has no idea what a turn costs or how close the session is to overflowing.
 */
function usage() {
	const stats = session().getSessionStats();
	const context = session().getContextUsage();
	return {
		type: "usage",
		cost: stats.cost,
		tokens: stats.tokens,
		messages: stats.totalMessages,
		toolCalls: stats.toolCalls,
		context: context ? { tokens: context.tokens, window: context.contextWindow, percent: context.percent } : null,
	};
}

/**
 * The conversation so far, in the same item shape the client builds from live
 * events. A resumed session has history but emits no events for it, so without
 * this the browser would show an empty conversation.
 */
function snapshot() {
	return { type: "snapshot", items: itemsFromMessages(session().messages) };
}

/** Saved sessions for this working directory, newest first. */
async function sessions() {
	const current = session().sessionFile;
	const list = (await SessionManager.list(CWD))
		.sort((a, b) => b.modified.getTime() - a.modified.getTime())
		.map((info) => ({
			path: info.path,
			id: info.id,
			name: info.name ?? null,
			modified: info.modified.toISOString(),
			messageCount: info.messageCount,
			firstMessage: info.firstMessage.slice(0, 80),
			current: info.path === current,
		}));

	// An empty session has no file on disk yet, so it is missing from the list.
	// Without a placeholder the picker would show a different session as selected.
	if (current && !list.some((s) => s.current)) {
		list.unshift({
			path: current,
			id: session().sessionId,
			name: session().sessionName ?? null,
			modified: new Date().toISOString(),
			messageCount: 0,
			firstMessage: "(새 대화)",
			current: true,
		});
	}
	return { type: "sessions", sessions: list };
}

const clients = new Set<WebSocket>();

function broadcast(payload: unknown): void {
	const text = safeStringify(payload);
	for (const client of clients) {
		if (client.readyState === client.OPEN) client.send(text);
	}
}

/**
 * The wire form of a session event, matching what pi's own print and rpc modes
 * send. A `message_update` ships the whole message being streamed twice — as
 * `message` and again as `assistantMessageEvent.partial` — and both are
 * reconstructible from the deltas the client already folds in. Dropping them
 * keeps the raw view readable at 300 events.
 */
function toWireEvent(event: AgentSessionEvent): unknown {
	if (event.type !== "message_update") return event;
	const usage = event.message.role === "assistant" ? event.message.usage : undefined;
	const sub = event.assistantMessageEvent;
	if (!("partial" in sub)) return { type: event.type, usage, assistantMessageEvent: sub };
	const { partial: _partial, ...delta } = sub;
	return { type: event.type, usage, assistantMessageEvent: delta };
}

function onEvent(event: AgentSessionEvent): void {
	broadcast(toWireEvent(event));
	// isStreaming and the queue drive the stop button and pending count.
	if (event.type === "agent_start" || event.type === "agent_settled" || event.type === "queue_update") {
		broadcast(config());
	}
	// Cost only moves when a message completes.
	if (event.type === "message_end" || event.type === "agent_settled") broadcast(usage());
}

let unsubscribe: (() => void) | undefined;

/** Rebind after the runtime swaps in a different AgentSession. */
async function bind(): Promise<void> {
	unsubscribe?.();
	await session().bindExtensions({});
	unsubscribe = session().subscribe(onEvent);
}

/** Push the full server state to every client. Used after a session is replaced. */
async function broadcastAll(): Promise<void> {
	broadcast(config());
	broadcast(usage());
	broadcast(snapshot());
	broadcast(await sessions());
}

await bind();

/**
 * Where `npm run build` puts the client. Absent until it has been run once.
 *
 * The desktop shell runs a bundled copy of this file from another directory, so
 * it says where the client is rather than letting the path be inferred from
 * wherever the module happens to sit.
 */
const CLIENT_DIR = process.env.CLIENT_DIR
	? pathToFileURL(process.env.CLIENT_DIR.replace(/\/?$/, "/"))
	: new URL("dist/", import.meta.url);

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".map": "application/json; charset=utf-8",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
	// The build hashes its asset names, so the set of files cannot be listed
	// ahead of time the way the two hand-written ones could be.
	const { pathname } = new URL(req.url ?? "/", "http://localhost");
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
	res.end(body);
});

const wss = new WebSocketServer({ server });

wss.on("connection", async (ws) => {
	clients.add(ws);
	ws.on("close", () => clients.delete(ws));
	// ws emits 'error' for a malformed frame. Node throws on an 'error' event
	// with no listener, so without this one bad frame takes the process down.
	ws.on("error", (err) => {
		console.error("websocket error:", err.message);
		clients.delete(ws);
	});
	ws.send(safeStringify(config()));
	ws.send(safeStringify(usage()));
	ws.send(safeStringify(snapshot()));

	ws.on("message", async (data) => {
		let msg: {
			type?: string;
			text?: string;
			names?: string[];
			level?: string;
			model?: string;
			behavior?: string;
			path?: string;
			name?: string;
		};
		try {
			msg = JSON.parse(data.toString());
		} catch {
			ws.send(safeStringify({ type: "error", message: "invalid JSON from client" }));
			return;
		}
		try {
			switch (msg.type) {
				case "prompt": {
					if (typeof msg.text !== "string") return;
					// "steer" redirects the run in progress; "followUp" waits for it to finish.
					const behavior = msg.behavior === "steer" ? "steer" : "followUp";
					// prompt() throws if the session is streaming and no behavior is given.
					await session().prompt(
						msg.text,
						session().isStreaming ? { streamingBehavior: behavior } : undefined,
					);
					break;
				}

				case "abort":
					await session().abort();
					broadcast(config());
					break;

				case "set_tools":
					if (!Array.isArray(msg.names)) return;
					// Takes effect on the next turn, not the one in flight.
					session().setActiveToolsByName(msg.names);
					broadcast(config());
					break;

				case "set_model": {
					const next = availableModels.find((m) => modelKey(m) === msg.model);
					if (!next) {
						ws.send(safeStringify({ type: "error", message: `unknown model: ${msg.model}` }));
						return;
					}
					// Throws when the model has no configured auth. Thinking level is
					// clamped to the new model, so the config broadcast reflects that too.
					await session().setModel(next);
					broadcast(config());
					break;
				}

				case "set_thinking": {
					// setThinkingLevel clamps rather than rejecting, so an unknown
					// value would silently become "off". Validate first.
					const levels = config().thinkingLevels;
					if (typeof msg.level !== "string" || !levels.includes(msg.level as ThinkingLevel)) {
						ws.send(safeStringify({ type: "error", message: `unsupported thinking level: ${msg.level}` }));
						return;
					}
					session().setThinkingLevel(msg.level as ThinkingLevel);
					broadcast(config());
					break;
				}

				case "new_session":
					// A run in progress would keep writing to the session being replaced.
					await session().abort();
					await runtime.newSession();
					await bind();
					await broadcastAll();
					break;

				case "resume_session": {
					if (typeof msg.path !== "string") return;
					// The current session may not be on disk yet; switching to it would fail.
					if (msg.path === session().sessionFile) return;
					const known = (await sessions()).sessions.some((s) => s.path === msg.path);
					if (!known) {
						ws.send(safeStringify({ type: "error", message: `unknown session: ${msg.path}` }));
						return;
					}
					await session().abort();
					await runtime.switchSession(msg.path);
					await bind();
					await broadcastAll();
					break;
				}

				case "set_session_name":
					if (typeof msg.name !== "string") return;
					session().setSessionName(msg.name);
					broadcast(config());
					broadcast(await sessions());
					break;
			}
		} catch (err) {
			broadcast({ type: "error", message: err instanceof Error ? err.message : String(err) });
		}
	});

	// Last, and only after the handler above is registered: reading the session
	// list touches the disk, and anything the client sent while that await was
	// outstanding would arrive at a socket with no 'message' listener and be
	// dropped without a trace.
	ws.send(safeStringify(await sessions()));
});

server.listen(PORT, HOST, () => {
	console.log(`open http://localhost:${PORT}  (ctrl+c to stop)`);
	if (HOST !== "127.0.0.1") console.log(`listening on ${HOST} — anyone who can reach it controls this machine`);
	console.log(`model: ${session().model?.id ?? "none"}  thinking: ${session().thinkingLevel}`);
	console.log(`session: ${session().sessionFile ?? "(not persisted)"}`);
});

let shuttingDown = false;
process.on("SIGINT", async () => {
	if (shuttingDown) return;
	shuttingDown = true;
	await runtime.dispose();
	// server.close() waits for open connections, and an upgraded WebSocket is
	// one of them. ws does not close them for us when the http server was
	// passed in, so a browser tab left open would hang the exit.
	for (const client of clients) client.terminate();
	server.close(() => process.exit(0));
});
