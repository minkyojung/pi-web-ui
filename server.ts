/**
 * Step 1: pass events through, render nothing.
 *
 * Serves index.html + client.js, holds one AgentSession, and forwards every
 * session event to connected browsers as raw JSON.
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

const PORT = Number(process.env.PORT ?? 3000);
/** "provider/id". Override with MODEL=anthropic/claude-opus-4-8 npm run dev */
const MODEL = process.env.MODEL ?? "openai/gpt-5.4";

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
const model = modelRuntime.getModel(provider, rest.join("/"));
if (!model) throw new Error(`unknown model: ${MODEL}`);

const { session } = await createAgentSession({
	model,
	modelRuntime,
	sessionManager: SessionManager.inMemory(),
});

/** Derived from the session so it stays in sync; pi does not re-export ThinkingLevel. */
type ThinkingLevel = typeof session.thinkingLevel;

/** Everything the settings UI needs. Re-sent whenever any of it changes. */
function config() {
	const model = session.model;
	return {
		type: "config",
		model: model ? `${model.provider}/${model.id}` : null,
		thinkingLevel: session.thinkingLevel,
		thinkingLevels: session.supportsThinking() ? session.getAvailableThinkingLevels() : [],
		tools: session.getAllTools().map((tool) => ({ name: tool.name, description: tool.description })),
		activeTools: session.getActiveToolNames(),
		isStreaming: session.isStreaming,
	};
}

/**
 * Token spend and context pressure. pi tracks both; without surfacing them the
 * user has no idea what a turn costs or how close the session is to overflowing.
 */
function usage() {
	const stats = session.getSessionStats();
	const context = session.getContextUsage();
	return {
		type: "usage",
		cost: stats.cost,
		tokens: stats.tokens,
		messages: stats.totalMessages,
		toolCalls: stats.toolCalls,
		context: context ? { tokens: context.tokens, window: context.contextWindow, percent: context.percent } : null,
	};
}

const clients = new Set<WebSocket>();
/** Every event type actually seen, printed on shutdown. This is the goal of step 1. */
const seenTypes = new Set<string>();

function broadcast(payload: unknown): void {
	const text = safeStringify(payload);
	for (const client of clients) {
		if (client.readyState === client.OPEN) client.send(text);
	}
}

session.subscribe((event: AgentSessionEvent) => {
	seenTypes.add(
		event.type === "message_update"
			? `message_update.${event.assistantMessageEvent.type}`
			: event.type,
	);
	broadcast(event);
	// isStreaming drives the stop button, so resend config when it flips.
	if (event.type === "agent_start" || event.type === "agent_settled") broadcast(config());
	// Cost only moves when a message completes.
	if (event.type === "message_end" || event.type === "agent_settled") broadcast(usage());
});

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

wss.on("connection", (ws) => {
	clients.add(ws);
	ws.on("close", () => clients.delete(ws));
	ws.send(safeStringify(config()));
	ws.send(safeStringify(usage()));

	ws.on("message", async (data) => {
		let msg: { type?: string; text?: string; names?: string[]; level?: string };
		try {
			msg = JSON.parse(data.toString());
		} catch {
			ws.send(safeStringify({ type: "error", message: "invalid JSON from client" }));
			return;
		}
		try {
			switch (msg.type) {
				case "prompt":
					if (typeof msg.text !== "string") return;
					// prompt() throws if the session is streaming and no behavior is given.
					await session.prompt(
						msg.text,
						session.isStreaming ? { streamingBehavior: "followUp" } : undefined,
					);
					break;

				case "abort":
					await session.abort();
					broadcast(config());
					break;

				case "set_tools":
					if (!Array.isArray(msg.names)) return;
					// Takes effect on the next turn, not the one in flight.
					session.setActiveToolsByName(msg.names);
					broadcast(config());
					break;

				case "set_thinking": {
					// setThinkingLevel clamps rather than rejecting, so an unknown
					// value would silently become "off". Validate first.
					const levels = config().thinkingLevels;
					if (typeof msg.level !== "string" || !levels.includes(msg.level as ThinkingLevel)) {
						ws.send(safeStringify({ type: "error", message: `unsupported thinking level: ${msg.level}` }));
						return;
					}
					session.setThinkingLevel(msg.level as ThinkingLevel);
					broadcast(config());
					break;
				}
			}
		} catch (err) {
			broadcast({ type: "error", message: err instanceof Error ? err.message : String(err) });
		}
	});
});

server.listen(PORT, () => {
	console.log(`open http://localhost:${PORT}  (ctrl+c to stop)`);
	console.log(`model: ${session.model?.id ?? "none"}  thinking: ${session.thinkingLevel}`);
});

let shuttingDown = false;
process.on("SIGINT", () => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log("\n--- event types seen this run ---");
	for (const type of [...seenTypes].sort()) console.log(type);
	session.dispose();
	server.close(() => process.exit(0));
});
