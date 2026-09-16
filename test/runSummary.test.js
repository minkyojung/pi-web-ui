import assert from "node:assert/strict";
import test from "node:test";

import { applyEvent, createConversation } from "../conversation.js";
import { rowsOf, summarise } from "../web/src/runSummary.ts";

const thinking = (text) => ({ kind: "thinking", text });
const tool = (name, extra = {}) => ({ kind: "tool", name, ...extra });
const kinds = (rows) => rows.map((row) => (row.kind === "group" ? `group(${row.items.length})` : "item"));

test("a summary names the tools a run reached for, in order, without repeating one", () => {
	const summary = summarise([thinking("…"), tool("read"), tool("read"), tool("grep")]);
	assert.equal(summary.thought, true);
	assert.deepEqual(summary.tools, ["read", "grep"]);
	assert.equal(summary.more, 0);
});

test("past three tools the rest become a count, so the line still fits", () => {
	const summary = summarise(["read", "grep", "edit", "bash", "write"].map((name) => tool(name)));
	assert.deepEqual(summary.tools, ["read", "grep", "edit"]);
	assert.equal(summary.more, 2);
	// Five calls of one tool are one name, not five.
	assert.equal(summarise(["read", "read", "read", "read"].map((name) => tool(name))).more, 0);
});

test("a run with no thinking in it does not claim to have thought", () => {
	assert.equal(summarise([tool("read")]).thought, false);
});

test("the lines a run changed are totalled across every edit in it", () => {
	const edit = (diff) => tool("edit", { details: { diff } });
	const summary = summarise([edit("+1 one\n-2 two\n 3 three"), edit("+4 four\n+5 five")]);
	assert.equal(summary.added, 3);
	assert.equal(summary.removed, 1);
});

test("failures are counted per call, not per tool", () => {
	const summary = summarise([tool("bash", { isError: true }), tool("bash", { isError: true }), tool("read")]);
	assert.equal(summary.failed, 2);
	assert.deepEqual(summary.tools, ["bash", "read"]);
});

test("the steps of a finished run fold into one row", () => {
	const items = [
		{ kind: "user", text: "hi" },
		thinking("…"),
		tool("ask_user"),
		thinking("…"),
		tool("web_search"),
		{ kind: "assistant", text: "the answer" },
		{ kind: "done" },
	];
	assert.deepEqual(kinds(rowsOf(items)), ["item", "group(4)", "item", "item"]);
	assert.equal(rowsOf(items)[1].index, 1);
});

test("a run still in flight is drawn exactly as it was, one row per item", () => {
	const items = [{ kind: "user", text: "hi" }, thinking("…"), tool("ask_user"), thinking("…")];
	assert.deepEqual(kinds(rowsOf(items)), ["item", "item", "item", "item"]);
});

test("the run in flight stays open while the runs above it stay folded", () => {
	const items = [thinking("…"), tool("read"), { kind: "done" }, { kind: "user", text: "again" }, thinking("…"), tool("grep")];
	assert.deepEqual(kinds(rowsOf(items)), ["group(2)", "item", "item", "item", "item"]);
});

test("a single step does not fold, since the folded line says less than the row", () => {
	const items = [tool("read"), { kind: "assistant", text: "…" }, tool("grep"), { kind: "done" }];
	assert.deepEqual(kinds(rowsOf(items)), ["item", "item", "item", "item"]);
});

test("steps are never hoisted over the words the model wrote between them", () => {
	const items = [
		thinking("…"),
		tool("read"),
		{ kind: "assistant", text: "let me search" },
		thinking("…"),
		tool("grep"),
		{ kind: "done" },
	];
	// Two groups, with the sentence still between them — not one group above it.
	assert.deepEqual(kinds(rowsOf(items)), ["group(2)", "item", "group(2)", "item"]);
});

test("an error stays on screen rather than folding into the line", () => {
	const items = [thinking("…"), { kind: "error", text: "no" }, tool("read"), { kind: "done" }];
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
	assert.equal(summary.thought, true);
	assert.deepEqual(summary.tools, ["ask_user", "web_search"]);
	assert.equal(summary.failed, 0);
});
