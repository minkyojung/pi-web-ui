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

/** One streamed assistant message, chopped the way a provider chops it. */
function say(text: string): Record<string, unknown>[] {
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
			message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
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

const written: Scenario[] = [
	{
		id: "tool-headers",
		name: "툴 헤더 요약",
		note: "toolSummary.ts 의 규칙 전부, 한 화면에. 마지막 두 개는 규칙이 없는 툴이라 툴 이름만 남아야 한다 — 그게 정상이다. 폭 슬라이더를 좁혀서 어디서 줄이 넘치는지 본다.",
		load: async () =>
			[
				{ type: "agent_start" },
				ask("이 저장소를 한 바퀴 둘러봐줘."),
				...run("h1", "ls", {}, ["conversation.js\nserver.ts\nweb\n"]),
				...run("h2", "ls", { path: "web/src/components" }, ["Composer.tsx\nItem.tsx\n"]),
				...run("h3", "find", { pattern: "**/*.test.js" }, ["test/conversation.test.js\n"]),
				...run("h4", "grep", { pattern: "applyEvent", path: "." }, ["conversation.js:94\n"]),
				...run("h5", "read", { path: "/Users/w/code/pi/web/src/components/Item.tsx" }, ["import { memo } from \"react\";\n"]),
				...run("h6", "write", { path: "notes.md", content: "…" }, ["wrote 1 file"]),
				...run("h7", "edit", { path: "web/src/store.ts", edits: [{ oldText: "a", newText: "b" }] }, ["1 edit applied"]),
				...run("h8", "edit", { path: "web/src/gallery/scenarios.ts", edits: [1, 2, 3].map(() => ({ oldText: "a", newText: "b" })) }, ["3 edits applied"]),
				...run("h9", "bash", { command: "npm test 2>&1 | tail -5" }, ["# pass 104\n"]),
				...run("h10", "bash", { command: `echo ${"긴 명령 ".repeat(20)}` }, ["…"]),
				...run("h11", "set_gist", { id: 12, gist: "한 줄 요약" }, ["12 · 어떤 글\n> 한 줄 요약"]),
				// No rule for these two, so the card keeps the plain tool name.
				...run("h12", "ask_user", { question: "계속할까요?" }, ["네"]),
				...run("h13", "some_extension_tool", { whatever: 1 }, ["ok"]),
				...say("한 바퀴 돌았습니다."),
				{ type: "agent_settled" },
			].map(wire),
	},
	{
		id: "tools",
		name: "Tool chain",
		note: "Four tools in one turn. This is where you see whether the collapsed cards alone tell you what happened.",
		load: async () =>
			[
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
			].map(wire),
	},
	{
		id: "long-output",
		name: "Long output · failed tool",
		note: "A result longer than the screen, and a tool that died. ToolOutput's max-h-72 is tested here.",
		load: async () =>
			[
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
				...say("`web/src/nope.ts` did not exist."),
				{ type: "agent_settled" },
			].map(wire),
	},
	{
		id: "notices",
		name: "Retry · compaction",
		note: "Notice items. Today they fall through Item.tsx's default branch into a single amber line.",
		load: async () =>
			[
				{ type: "agent_start" },
				ask("Let us continue this long conversation."),
				{ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "529 overloaded" },
				{ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "529 overloaded" },
				{ type: "auto_retry_end", success: true, attempt: 2 },
				{ type: "compaction_start", reason: "threshold" },
				{ type: "compaction_end", reason: "threshold", result: { tokensBefore: 184320 }, aborted: false, willRetry: false },
				...say("Continuing."),
				{ type: "agent_settled" },
			].map(wire),
	},
	{
		id: "error",
		name: "Provider error",
		note: "Both paths: stopReason:error on message_end, and a top-level error event.",
		load: async () =>
			[
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
			].map(wire),
	},
	{
		id: "thinking",
		name: "Thinking stream (not rendered yet)",
		note: "pi sends it, but conversation.js has no case for it, so not one character reaches the screen. Seeing only the answer text is expected — this gap is the next job.",
		load: async () => {
			const thought =
				"The user asked how a conversation is built. applyEvent in conversation.js is the core, and store.ts projects it into something React can see. Both need to be mentioned.";
			return [
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
			].map(wire);
		},
	},
];

export const scenarios: Scenario[] = [...written, ...recorded];
