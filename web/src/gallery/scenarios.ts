/**
 * What the gallery replays.
 *
 * Two sources, and the difference between them matters. Recordings are real pi
 * sessions (`npm run record`), so they can only show shapes pi actually emits.
 * Written scenarios are not: they cover the states a recording would be
 * expensive or unlucky to catch — a retry storm, a compaction, a tool that
 * fails — and they are only as honest as the types they were written against.
 * Anything written here is copied from pi's AgentEvent/AssistantMessageEvent
 * union; if it drifts, the gallery tunes a fiction.
 */
import type { ServerMsg } from "../types";

export interface Scenario {
	id: string;
	name: string;
	/** Why this one is here, and anything it is known not to show. */
	note?: string;
	load: () => Promise<ServerMsg[]>;
}

/**
 * The wire form of an event, as server.ts sends it.
 *
 * A recording holds raw session events, which carry the whole message being
 * streamed twice; the browser never sees those. This is the same trim
 * server.ts:toWireEvent does, repeated here rather than imported because that
 * module opens a pi session on load. The reducer ignores the extra fields
 * either way — this is so the raw pane shows what the browser would really get.
 */
function wire(event: Record<string, unknown>): ServerMsg {
	if (event.type !== "message_update") return event as ServerMsg;
	const message = event.message as { role?: string; usage?: unknown } | undefined;
	const usage = message?.role === "assistant" ? message.usage : undefined;
	const sub = event.assistantMessageEvent as Record<string, unknown>;
	if (!("partial" in sub)) return { type: "message_update", usage, assistantMessageEvent: sub } as ServerMsg;
	const { partial: _partial, ...delta } = sub;
	return { type: "message_update", usage, assistantMessageEvent: delta } as ServerMsg;
}

/** Every fixture the test suite has, without naming them one by one. */
const recordings = import.meta.glob<{ default: Record<string, unknown>[] }>("../../../test/fixtures/*.json");

const recorded: Scenario[] = Object.entries(recordings).map(([path, load]) => {
	const file = path.slice(path.lastIndexOf("/") + 1, -".json".length);
	return {
		id: `recorded:${file}`,
		name: `recorded · ${file}`,
		note: "A real recorded pi session. It is the same file the tests use, so if a pi upgrade changes the shape, the tests break first.",
		load: async () => (await load()).default.map(wire),
	};
});

// ---------------------------------------------------------------------------
// Written scenarios.

/**
 * What one assistant message bills.
 *
 * Roughly what a short turn on a large model costs, so the footer has real
 * figures to be laid out against; the shape is pi's Usage.
 */
const usage = (output: number) => ({
	input: 12_400,
	output,
	cacheRead: 11_200,
	cacheWrite: 0,
	totalTokens: 12_400 + output,
	cost: {
		input: 0.0037,
		output: output * 0.00001,
		cacheRead: 0.0003,
		cacheWrite: 0,
		total: 0.004 + output * 0.00001,
	},
});

/** One streamed assistant message, chopped the way a provider chops it. */
function say(text: string, stopReason = "stop"): Record<string, unknown>[] {
	const chunks = text.match(/.{1,12}/gs) ?? [];
	return [
		{ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
		...chunks.map((delta) => ({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
		})),
		{ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 0, content: text } },
		{
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text }], stopReason, usage: usage(text.length * 2) },
		},
	];
}

const ask = (text: string) => ({
	type: "message_start",
	message: { role: "user", content: [{ type: "text", text }] },
});

const text = (body: string) => ({ content: [{ type: "text", text: body }] });

/** A tool call that streams its output in, the way bash does. */
function run(
	id: string,
	name: string,
	args: unknown,
	output: string[],
	{ isError = false } = {},
): Record<string, unknown>[] {
	let far = "";
	return [
		{ type: "tool_execution_start", toolCallId: id, toolName: name, args },
		...output.map((chunk) => {
			far += chunk;
			// Partial output is a cumulative snapshot, not an append.
			return { type: "tool_execution_update", toolCallId: id, toolName: name, args, partialResult: text(far) };
		}),
		{ type: "tool_execution_end", toolCallId: id, toolName: name, result: text(far), isError },
	];
}

/**
 * A written run, on the wire and on a clock.
 *
 * Recordings carry pi's own timestamps; written events have none, so a `done`
 * would have no duration to show. The clock starts a few minutes ago and walks
 * forward, spending longer on a tool than on a message, which is what makes a
 * replayed run read like a run rather than like an instant.
 */
function script(events: Record<string, unknown>[]): ServerMsg[] {
	let at = Date.now() - 4 * 60_000;
	return events.map((event) => {
		at += event.type === "tool_execution_end" ? 2400 : 500;
		const message = event.message as Record<string, unknown> | undefined;
		return wire(message ? { ...event, message: { ...message, timestamp: at } } : event);
	});
}

const written: Scenario[] = [
	{
		id: "tool-headers",
		name: "Tool rows",
		note: "Every rule in toolSummary.ts on one screen. The last two tools have no rule, so they keep the bare tool name — that is the correct outcome. Narrow the width slider to find where a line gives out.",
		load: async () =>
			script([
				{ type: "agent_start" },
				ask("Take a walk around this repository."),
				...run("h1", "ls", {}, ["conversation.js\nserver.ts\nweb\n"]),
				...run("h2", "ls", { path: "web/src/components" }, ["Composer.tsx\nItem.tsx\n"]),
				...run("h3", "find", { pattern: "**/*.test.js" }, ["test/conversation.test.js\n"]),
				...run("h4", "grep", { pattern: "applyEvent", path: "." }, ["conversation.js:94\n"]),
				...run("h5", "read", { path: "/Users/w/code/pi/web/src/components/Item.tsx" }, ["import { memo } from \"react\";\n"]),
				...run("h6", "write", { path: "notes.md", content: "…" }, ["wrote 1 file"]),
				...run("h7", "edit", { path: "web/src/store.ts", edits: [{ oldText: "a", newText: "b" }] }, ["1 edit applied"]),
				...run("h8", "edit", { path: "web/src/gallery/scenarios.ts", edits: [1, 2, 3].map(() => ({ oldText: "a", newText: "b" })) }, ["3 edits applied"]),
				...run("h9", "bash", { command: "npm test 2>&1 | tail -5" }, ["# pass 104\n"]),
				...run("h10", "bash", { command: `echo ${"a long command ".repeat(20)}` }, ["…"]),
				...run("h11", "set_gist", { id: 12, gist: "One line about it" }, ["12 · Some piece\n> One line about it"]),
				// No rule for these two, so the row keeps the plain tool name.
				...run("h12", "ask_user", { question: "Carry on?" }, ["yes"]),
				...run("h13", "some_extension_tool", { whatever: 1 }, ["ok"]),
				...say("That is the walk around."),
				{ type: "agent_settled" },
			]),
	},
	{
		id: "tools",
		name: "Tool chain",
		note: "Four tools in one turn. This is where you see whether the collapsed cards alone tell you what happened.",
		load: async () =>
			script([
				{ type: "agent_start" },
				ask("Explain how a conversation is built in this project."),
				...say("Let me look."),
				...run("t1", "grep", { pattern: "applyEvent", path: "." }, ["conversation.js:92\nweb/src/store.ts:57\ntest/conversation.test.js:26\n"]),
				...run("t2", "read", { path: "conversation.js", offset: 80, limit: 40 }, ["export function applyEvent(state, event) {\n\tconst added = [];\n\tconst changed = [];\n"]),
				...run("t3", "ls", { path: "web/src/components" }, ["Composer.tsx\nContextGauge.tsx\nConversation.tsx\nItem.tsx\n"]),
				...run("t4", "bash", { command: "npm test 2>&1 | tail -5" }, [
					"# tests 24\n",
					"# tests 24\n# pass 24\n",
					"# tests 24\n# pass 24\n# fail 0\n# duration_ms 812\n",
				]),
				...say("`applyEvent` in `conversation.js` folds session events into items. Both paths live in one file so a live stream and a resumed session end up the same."),
				{ type: "agent_settled" },
			]),
	},
	{
		id: "long-output",
		name: "Long output · failed tool",
		note: "A result longer than the screen, a tool that died, and a run cut off at the token limit — the footer should say `truncated`, because a cut answer reads exactly like a finished one.",
		load: async () =>
			script([
				{ type: "agent_start" },
				ask("Run the tests and fix what fails."),
				...run(
					"t1",
					"bash",
					{ command: "npm test" },
					[Array.from({ length: 60 }, (_, i) => `  ok ${i + 1} - conversation replays ${i + 1}`).join("\n")],
				),
				...run("t2", "read", { path: "web/src/nope.ts" }, ["ENOENT: no such file or directory, open 'web/src/nope.ts'"], {
					isError: true,
				}),
				...run("t3", "edit", { path: "web/src/store.ts", edits: [{ oldText: "…", newText: "…" }] }, [""]),
				...say("`web/src/nope.ts` did not exist, and this answer was cut off at the token limit before it could say what to do about", "length"),
				{ type: "agent_settled" },
			]),
	},
	{
		id: "notices",
		name: "Rules · retry · compaction",
		note: "Notices and done markers — the rules drawn across a conversation. Four of them stack up here, which is where it shows whether they mark the flow or cut it. A retry is one item being reworded, so play it slowly to watch the line change.",
		load: async () =>
			script([
				{ type: "agent_start" },
				ask("Let us continue this long conversation."),
				{ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "529 overloaded" },
				{ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "529 overloaded" },
				{ type: "auto_retry_end", success: true, attempt: 2 },
				...say("Continuing."),
				{ type: "agent_settled" },
				ask("Keep going."),
				{ type: "compaction_start", reason: "threshold" },
				{ type: "compaction_end", reason: "threshold", result: { tokensBefore: 184320 }, aborted: false, willRetry: false },
				...say("Compacted, and carrying on."),
				{ type: "agent_settled" },
				ask("Once more."),
				{ type: "auto_retry_start", attempt: 1, maxAttempts: 2, delayMs: 2000, errorMessage: "529 overloaded" },
				{ type: "auto_retry_end", success: false, attempt: 2, finalError: '429 {"error":{"message":"rate limit exceeded"}}' },
				{ type: "agent_settled" },
			]),
	},
	{
		id: "error",
		name: "Provider error",
		note: "Both paths: stopReason:error on message_end, and a top-level error event.",
		load: async () =>
			script([
				{ type: "agent_start" },
				ask("Read this very long file in full."),
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [],
						stopReason: "error",
						errorMessage:
							'400 {"error":{"message":"prompt is too long: 213401 tokens > 200000 maximum","type":"invalid_request_error"}}',
					},
				},
				{ type: "error", message: "ECONNRESET" },
				{ type: "agent_settled" },
			]),
	},
	{
		id: "thinking",
		name: "Thinking stream (not rendered yet)",
		note: "pi sends it, but conversation.js has no case for it, so not one character reaches the screen. Seeing only the answer text is expected — this gap is the next job.",
		load: async () => {
			const thought =
				"The user asked how a conversation is built. applyEvent in conversation.js is the core, and store.ts projects it into something React can see. Both need to be mentioned.";
			return script([
				{ type: "agent_start" },
				ask("How is a conversation built?"),
				{ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
				...(thought.match(/.{1,10}/gs) ?? []).map((delta) => ({
					type: "message_update",
					assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta },
				})),
				{ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: thought } },
				...say("`applyEvent` in `conversation.js` folds, and `store.ts` projects."),
				{ type: "agent_settled" },
			]);
		},
	},
];

export const scenarios: Scenario[] = [...written, ...recorded];
