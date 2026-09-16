import assert from "node:assert/strict";
import test from "node:test";

import { applyEvent, createConversation } from "../conversation.js";
import { rowsOf, summarise } from "../web/src/runSummary.ts";

const thinking = (message, text = "…") => ({ kind: "thinking", text, message });
const tool = (message, name, extra = {}) => ({ kind: "tool", name, message, ...extra });
const kinds = (rows) => rows.map((row) => (row.kind === "group" ? `group(${row.items.length})` : "item"));

test("a summary counts the calls and the messages they came from", () => {
	// Two messages, each thinking and then calling a tool — the shape of the
	// screenshot this was built for.
	const summary = summarise([thinking(1), tool(1, "ask_user"), thinking(2), tool(2, "web_search")]);
	assert.equal(summary.tools, 2);
	assert.equal(summary.messages, 2);
});

test("two calls in one message are two tools and one message", () => {
	const summary = summarise([tool(1, "read"), tool(1, "read")]);
	assert.equal(summary.tools, 2);
	assert.equal(summary.messages, 1);
});

test("two thoughts in one message do not read as two messages", () => {
	// The whole reason a step carries the message it came from: by eye these
	// are indistinguishable from two thoughts in two messages.
	assert.equal(summarise([thinking(1, "a"), thinking(1, "b")]).messages, 1);
	assert.equal(summarise([thinking(1, "a"), thinking(2, "b")]).messages, 2);
});

test("a run that only thought has no tools to count", () => {
	const summary = summarise([thinking(1), thinking(2)]);
	assert.equal(summary.tools, 0);
	assert.equal(summary.messages, 2);
});

test("failures are counted per call", () => {
	const summary = summarise([tool(1, "bash", { isError: true }), tool(1, "bash", { isError: true }), tool(2, "read")]);
	assert.equal(summary.failed, 2);
	assert.equal(summary.tools, 3);
});

test("the steps of a finished run fold into one row", () => {
	const items = [
		{ kind: "user", text: "hi" },
		thinking(1),
		tool(1, "ask_user"),
		thinking(1),
		tool(2, "web_search"),
		{ kind: "assistant", text: "the answer" },
		{ kind: "done" },
	];
	assert.deepEqual(kinds(rowsOf(items)), ["item", "group(4)", "item", "item"]);
	assert.equal(rowsOf(items)[1].index, 1);
});

test("a run still in flight is drawn exactly as it was, one row per item", () => {
	const items = [{ kind: "user", text: "hi" }, thinking(1), tool(1, "ask_user"), thinking(1)];
	assert.deepEqual(kinds(rowsOf(items)), ["item", "item", "item", "item"]);
});

test("the run in flight stays open while the runs above it stay folded", () => {
	const items = [thinking(1), tool(1, "read"), { kind: "done" }, { kind: "user", text: "again" }, thinking(1), tool(2, "grep")];
	assert.deepEqual(kinds(rowsOf(items)), ["group(2)", "item", "item", "item", "item"]);
});

test("a single step does not fold, since the folded line says less than the row", () => {
	const items = [tool(1, "read"), { kind: "assistant", text: "…" }, tool(2, "grep"), { kind: "done" }];
	assert.deepEqual(kinds(rowsOf(items)), ["item", "item", "item", "item"]);
});

test("steps are never hoisted over the words the model wrote between them", () => {
	const items = [
		thinking(1),
		tool(1, "read"),
		{ kind: "assistant", text: "let me search" },
		thinking(1),
		tool(2, "grep"),
		{ kind: "done" },
	];
	// Two groups, with the sentence still between them — not one group above it.
	assert.deepEqual(kinds(rowsOf(items)), ["group(2)", "item", "group(2)", "item"]);
});

test("an error stays on screen rather than folding into the line", () => {
	const items = [thinking(1), { kind: "error", text: "no" }, tool(1, "read"), { kind: "done" }];
	assert.deepEqual(kinds(rowsOf(items)), ["item", "item", "item", "item"]);
});

test("a run folded from real events holds that run's steps and no others", () => {
	const state = createConversation();
	const toolCall = (id, name) => ({
		type: "tool_execution_start",
		toolCallId: id,
		toolName: name,
		args: {},
	});
	for (const event of [
		{ type: "agent_start" },
		{ type: "message_start", message: { role: "user", content: [{ type: "text", text: "weather?" }], timestamp: 1 } },
		{ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "clarifying" } },
		toolCall("a", "ask_user"),
		{ type: "tool_execution_end", toolCallId: "a", result: { content: [{ type: "text", text: "Seoul" }] } },
		{ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "searching" } },
		toolCall("b", "web_search"),
		{ type: "tool_execution_end", toolCallId: "b", result: { content: [{ type: "text", text: "cloudy" }] } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Cloudy tomorrow." } },
		{ type: "message_end", message: { role: "assistant", content: [], timestamp: 2 } },
		{ type: "agent_settled" },
	]) {
		applyEvent(state, event);
	}
	const rows = rowsOf(state.items);
	const group = rows.find((row) => row.kind === "group");
	assert.ok(group, "the finished run's steps fold");
	const summary = summarise(group.items);
	assert.equal(summary.tools, 2);
	// One message here: the recording streams both thoughts and both calls
	// without a second message_start, and the count says so rather than
	// guessing two from the two thoughts.
	assert.equal(summary.messages, 1);
	assert.equal(summary.failed, 0);
});
