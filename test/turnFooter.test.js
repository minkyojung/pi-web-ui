import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyEvent, createConversation, itemsFromMessages } from "../conversation.js";
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

// ---------------------------------------------------------------------------
// The same footer, off a session file.

const stored = (messages) => itemsFromMessages(messages).filter((item) => item.kind === "done");

test("a resumed run is dated, billed and ended the same as a live one", () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "go" }], timestamp: 1000 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "t1", name: "ls", arguments: {} }],
			stopReason: "toolUse",
			timestamp: 2000,
			usage: { totalTokens: 900, cost: { total: 0.004 } },
		},
		{ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "a" }], isError: false, timestamp: 2500 },
		{
			role: "assistant",
			content: [{ type: "text", text: "here" }],
			stopReason: "length",
			timestamp: 4500,
			usage: { totalTokens: 540, cost: { total: 0.0035 } },
		},
	];
	const [done] = stored(messages);
	assert.equal(done.startedAt, 1000);
	// A tool result is not a message live, so its time does not end the run.
	assert.equal(done.endedAt, 4500);
	assert.equal(done.tokens, 1440);
	assert.equal(Math.round(done.cost * 10_000), 75);
	assert.equal(done.stopReason, "length");
	assert.equal(done.answer, "here");
});

test("a session file is cut into runs by its user messages", () => {
	const say = (text, timestamp) => ({ role: "assistant", content: [{ type: "text", text }], timestamp, stopReason: "stop" });
	const items = itemsFromMessages([
		{ role: "user", content: [{ type: "text", text: "one" }], timestamp: 1000 },
		say("first", 2000),
		{ role: "user", content: [{ type: "text", text: "two" }], timestamp: 3000 },
		say("second", 4000),
	]);
	assert.deepEqual(
		items.map((item) => item.kind),
		["user", "assistant", "done", "user", "assistant", "done"],
	);
	const [first, second] = items.filter((item) => item.kind === "done");
	// Each run is dated and copied on its own, not from the first message on.
	assert.deepEqual([first.startedAt, first.endedAt], [1000, 2000]);
	assert.deepEqual([second.startedAt, second.endedAt], [3000, 4000]);
	assert.equal(second.answer, "second");
});

test("a user message with nothing after it closes no run", () => {
	// A session saved with the question still in flight has nothing to settle.
	const items = itemsFromMessages([{ role: "user", content: [{ type: "text", text: "go" }], timestamp: 1000 }]);
	assert.deepEqual(
		items.map((item) => item.kind),
		["user"],
	);
});

test("live and resumed close a real recorded run identically", () => {
	const events = JSON.parse(readFileSync(new URL("fixtures/turn-with-tools.json", import.meta.url), "utf8"));
	const state = createConversation();
	for (const event of events) applyEvent(state, event);

	const live = state.items.filter((item) => item.kind === "done");
	const resumed = stored(events.findLast((event) => event.type === "agent_end").messages);

	// The whole point of the two paths: a conversation must not change when it
	// is reloaded. Before this, a resumed session had no `done` at all, so an
	// answer cut off at the token limit came back looking finished.
	assert.deepEqual(resumed, live);
	assert.equal(live.length, 1);
	assert.ok(live[0].tokens > 0 && live[0].cost > 0);
});
