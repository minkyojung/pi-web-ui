/**
 * A web UI over one pi coding-agent session.
 *
 * Serves index.html + client.js, owns an AgentSessionRuntime, and forwards
 * every session event to connected browsers as raw JSON. The browser holds no
 * state of its own: config, usage, sessions, and snapshot messages describe the
 * server's state and are rebroadcast whenever it changes.
 */

import { readFile } from "node:fs/promises";
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

const PORT = Number(process.env.PORT ?? 3000);
/** "provider/id". Only the starting model; the UI can switch it live. */
const MODEL = process.env.MODEL ?? "openai/gpt-5.4";
const CWD = process.cwd();

/** JSON.stringify that survives circular references and Error values. */
function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(
		value,
		(_key, val) => {
			if (val instanceof Error) return { name: val.name, message: val.message };
			if (typeof val === "bigint") return val.toString();
			if (typeof val === "object" && val !== null) {
				if (seen.has(val)) return "[Circular]";
				seen.add(val);
			}
			return val;
		},
		2,
	);
}

const [provider, ...rest] = MODEL.split("/");
const modelRuntime = await ModelRuntime.create();
const startingModel = modelRuntime.getModel(provider, rest.join("/"));
if (!startingModel) throw new Error(`unknown model: ${MODEL}`);

/** Models with usable credentials. Fixed for the process; auth does not change while running. */
const availableModels = await modelRuntime.getAvailable();
const modelKey = (m: { provider: string; id: string }) => `${m.provider}/${m.id}`;

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

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.filter((c) => c?.type === "text").map((c) => c.text).join("")
			: "";

/**
 * The conversation so far, in the same item shape the client builds from live
 * events. A resumed session has history but emits no events for it, so without
 * this the browser would show an empty conversation.
 */
function snapshot() {
	const items: any[] = [];
	const toolItems = new Map<string, any>();

	for (const message of session().messages) {
		if (message.role === "user") {
			const text = textOf(message.content);
			if (text) items.push({ kind: "user", text });
		} else if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type === "text" && part.text) {
					items.push({ kind: "assistant", text: part.text });
				} else if (part.type === "toolCall") {
					const item = { kind: "tool", name: part.name, args: part.arguments, result: null, isError: false };
					toolItems.set(part.id, item);
					items.push(item);
				}
			}
			if (message.stopReason === "error" && message.errorMessage) {
				items.push({ kind: "error", text: message.errorMessage });
			}
		} else if (message.role === "toolResult") {
			const item = toolItems.get(message.toolCallId);
			if (item) {
				item.result = textOf(message.content);
				item.isError = message.isError;
			}
		}
	}
	return { type: "snapshot", items };
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

function onEvent(event: AgentSessionEvent): void {
	broadcast(event);
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

const STATIC_FILES: Record<string, string> = {
	"/": "index.html",
	"/index.html": "index.html",
	"/client.js": "client.js",
};

const server = createServer(async (req, res) => {
	const file = STATIC_FILES[req.url ?? "/"];
	if (!file) {
		res.writeHead(404).end("Not found");
		return;
	}
	const body = await readFile(new URL(file, import.meta.url));
	res.writeHead(200, {
		"content-type": file.endsWith(".js")
			? "text/javascript; charset=utf-8"
			: "text/html; charset=utf-8",
	});
	res.end(body);
});

const wss = new WebSocketServer({ server });

wss.on("connection", async (ws) => {
	clients.add(ws);
	ws.on("close", () => clients.delete(ws));
	ws.send(safeStringify(config()));
	ws.send(safeStringify(usage()));
	ws.send(safeStringify(snapshot()));
	ws.send(safeStringify(await sessions()));

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
});

server.listen(PORT, () => {
	console.log(`open http://localhost:${PORT}  (ctrl+c to stop)`);
	console.log(`model: ${session().model?.id ?? "none"}  thinking: ${session().thinkingLevel}`);
	console.log(`session: ${session().sessionFile ?? "(not persisted)"}`);
});

let shuttingDown = false;
process.on("SIGINT", async () => {
	if (shuttingDown) return;
	shuttingDown = true;
	await runtime.dispose();
	server.close(() => process.exit(0));
});
