import assert from "node:assert/strict";
import test from "node:test";

import { applyEvent, createConversation } from "../conversation.js";
import { formatCost, formatDuration, formatTokens, stopNote, turnParts } from "../web/src/turn.ts";

const at = (timestamp) => ({ role: "assistant", content: [], timestamp });

test("a run is dated from its own messages, not from a clock", () => {
	const state = createConversation();
	for (const event of [
		{ type: "agent_start" },
		{ type: "message_start", message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1000 } },
		{ type: "message_end", message: at(4500) },
		{ type: "agent_settled" },
	]) {
		applyEvent(state, event);
	}
	const done = state.items.at(-1);
	assert.equal(done.kind, "done");
	assert.equal(done.startedAt, 1000);
	assert.equal(done.endedAt, 4500);
	// Replaying the same events has to give the same answer, or a recording
	// would produce a different conversation every time it was played.
	assert.deepEqual(turnParts(done), turnParts({ startedAt: 1000, endedAt: 4500 }));
});

test("each run is timed on its own, not from the first one", () => {
	const state = createConversation();
	const run = (from, to) => {
		applyEvent(state, { type: "agent_start" });
		applyEvent(state, { type: "message_start", message: { role: "user", content: [], timestamp: from } });
		applyEvent(state, { type: "message_end", message: at(to) });
		applyEvent(state, { type: "agent_settled" });
	};
	run(1000, 2000);
	run(60000, 61000);
	const [first, second] = state.items.filter((item) => item.kind === "done");
	assert.equal(first.startedAt, 1000);
	assert.equal(second.startedAt, 60000);
});

test("messages arriving out of order still bound the run", () => {
	const state = createConversation();
	applyEvent(state, { type: "agent_start" });
	applyEvent(state, { type: "message_end", message: at(5000) });
	applyEvent(state, { type: "message_end", message: at(2000) });
	applyEvent(state, { type: "agent_settled" });
	const done = state.items.at(-1);
	assert.equal(done.startedAt, 2000);
	assert.equal(done.endedAt, 5000);
});

test("a run with no times at all still ends, it just has nothing to say", () => {
	const state = createConversation();
	applyEvent(state, { type: "agent_start" });
	applyEvent(state, { type: "message_end", message: { role: "assistant", content: [] } });
	applyEvent(state, { type: "agent_settled" });
	const done = state.items.at(-1);
	assert.equal(done.startedAt, null);
	assert.equal(done.endedAt, null);
	assert.deepEqual(turnParts({}), []);
});

test("the unit follows the size", () => {
	assert.equal(formatDuration(400), "0.4s");
	assert.equal(formatDuration(4230), "4.2s");
	assert.equal(formatDuration(9990), "10s");
	assert.equal(formatDuration(42_400), "42s");
	assert.equal(formatDuration(60_000), "1m");
	assert.equal(formatDuration(81_000), "1m 21s");
	assert.equal(formatDuration(3_661_000), "61m 1s");
	assert.equal(formatDuration(-1), "");
	assert.equal(formatDuration(Number.NaN), "");
});

test("a footer with a time but no start is still worth showing", () => {
	assert.equal(turnParts({ endedAt: Date.parse("2026-09-07T15:28:00") }).length, 1);
	assert.equal(turnParts({ startedAt: 1000, endedAt: 82_000 })[0], "1m 21s");
});

test("a run is billed across all of its messages, not just the last", () => {
	const usage = (totalTokens, total) => ({ totalTokens, cost: { total } });
	const said = (totalTokens, total, stopReason) => ({
		type: "message_end",
		message: { role: "assistant", content: [], timestamp: 1000, stopReason, usage: usage(totalTokens, total) },
	});
	const state = createConversation();
	applyEvent(state, { type: "agent_start" });
	// A turn that calls a tool is several assistant messages, each billed, and
	// the last of them is usually the cheapest.
	applyEvent(state, said(900, 0.004, "toolUse"));
	applyEvent(state, said(500, 0.003, "toolUse"));
	applyEvent(state, said(40, 0.0006, "length"));
	applyEvent(state, { type: "agent_settled" });
	const done = state.items.at(-1);
	assert.equal(done.tokens, 1440);
	assert.equal(Math.round(done.cost * 10_000), 76);
	// The ending is the last message's, not the first's.
	assert.equal(done.stopReason, "length");
});

test("a message with no usage costs the run nothing rather than NaN", () => {
	const state = createConversation();
	applyEvent(state, { type: "agent_start" });
	applyEvent(state, { type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } });
	applyEvent(state, { type: "message_end", message: { role: "user", content: [] } });
	applyEvent(state, { type: "agent_settled" });
	const done = state.items.at(-1);
	assert.equal(done.tokens, null);
	assert.equal(done.cost, null);
	// A user message has no stopReason and must not erase the assistant's.
	assert.equal(done.stopReason, "stop");
});

test("only an ending worth saying is said", () => {
	assert.equal(stopNote("stop"), null);
	assert.equal(stopNote("toolUse"), null);
	assert.equal(stopNote(undefined), null);
	assert.equal(stopNote("whatever pi invents next"), null);
	assert.equal(stopNote("length"), "truncated");
	assert.equal(stopNote("aborted"), "stopped");
	assert.equal(stopNote("error"), "failed");
});

test("figures are written at the precision they are read at", () => {
	assert.equal(formatTokens(834), "834 tok");
	assert.equal(formatTokens(1440), "1.4k tok");
	assert.equal(formatTokens(184_320), "184k tok");
	assert.equal(formatTokens(0), "");
	// Fractions of a cent are most runs; two decimals would round them all away.
	assert.equal(formatCost(0.0087), "$0.0087");
	assert.equal(formatCost(1.234), "$1.23");
	assert.equal(formatCost(0), "");
});

test("the answer travels with the run that produced it, for copying", () => {
	const state = createConversation();
	const run = (text) => {
		applyEvent(state, { type: "agent_start" });
		applyEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
		applyEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } });
		applyEvent(state, { type: "tool_execution_start", toolCallId: "t", toolName: "ls", args: {} });
		applyEvent(state, { type: "tool_execution_end", toolCallId: "t", result: "a\nb", isError: false });
		applyEvent(state, { type: "agent_settled" });
	};
	run("first answer");
	run("second answer");
	const [first, second] = state.items.filter((item) => item.kind === "done");
	assert.equal(first.answer, "first answer");
	// The second run copies its own answer, not everything said so far, and
	// nothing a tool printed.
	assert.equal(second.answer, "second answer");
});
