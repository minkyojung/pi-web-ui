import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	applyEvent,
	createConversation,
	errorText,
	itemsFromMessages,
	resultText,
} from "../conversation.js";

const fixture = (name) =>
	JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));

/** Real recordings from a live pi session. Refresh with `npm run record`. */
const TURN = fixture("turn-with-tools");
const ERROR = fixture("provider-error");

function replay(events) {
	const state = createConversation();
	const touched = [];
	for (const event of events) {
		const { added, changed } = applyEvent(state, event);
		touched.push(added.length + changed.length);
	}
	return { state, touched };
}

/** Items minus the fields a renderer owns, for comparing the two paths. */
const comparable = (items) =>
	items
		.filter((item) => item.kind !== "done")
		.map(({ kind, text, name, args, result, isError }) => ({ kind, text, name, args, result, isError }));

test("live events and stored messages produce the same conversation", async (t) => {
	// agent_end carries the run's messages, which for these single-turn
	// recordings is the whole conversation. A multi-turn recording would need
	// the session's messages instead.
	for (const [name, events] of [
		["turn with tools", TURN],
		["provider error", ERROR],
	]) {
		await t.test(name, () => {
			const live = replay(events).state.items;
			const stored = itemsFromMessages(events.findLast((e) => e.type === "agent_end").messages);
			assert.deepEqual(comparable(stored), comparable(live));
			assert.ok(live.length > 0);
		});
	}
});

test("a turn with tool calls renders as user, tools, reply, done", () => {
	const { state } = replay(TURN);

	assert.deepEqual(
		state.items.map((item) => item.kind),
		["user", "tool", "tool", "assistant", "done"],
	);

	const [user, bash, read, reply] = state.items;
	assert.match(user.text, /^Run `ls -1`/);

	assert.equal(bash.name, "bash");
	assert.deepEqual(bash.args, { command: "ls -1" });
	assert.match(bash.result, /README\.md/);
	assert.equal(bash.isError, false);

	assert.equal(read.name, "read");
	assert.match(read.result, /"name": "khartoum"/);

	assert.match(reply.text, /README\.md/);
	assert.equal(state.status, "idle");
});

test("a provider failure surfaces the sentence, not the 400 envelope", () => {
	const { state } = replay(ERROR);

	assert.deepEqual(
		state.items.map((item) => item.kind),
		["user", "error", "done"],
	);
	const error = state.items[1];
	assert.equal(error.text, "You're out of extra usage. Add more at claude.ai/settings/usage and keep going.");
	assert.doesNotMatch(error.text, /^400/);
});

test("errorText unwraps only what it can", () => {
	assert.equal(
		errorText('400 {"type":"error","error":{"type":"x","message":"nope"}}'),
		"nope",
	);
	assert.equal(errorText("plain failure"), "plain failure");
	assert.equal(errorText("500 {not json"), "500 {not json");
	assert.equal(errorText('400 {"error":{}}'), '400 {"error":{}}');
});

test("resultText shows an unexpected shape rather than dropping it", () => {
	assert.equal(resultText("plain"), "plain");
	assert.equal(resultText({ content: [{ type: "text", text: "hi" }] }), "hi");
	assert.equal(resultText({ content: [{ type: "image" }] }), "");
	// The old server path returned "" here, so a resumed session lost the result.
	assert.equal(resultText({ unexpected: 1 }), '{"unexpected":1}');
});

test("a reply that never streams is shown once", () => {
	const message = { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" };
	const { state } = replay([
		{ type: "message_start", message },
		{ type: "message_end", message },
	]);
	assert.deepEqual(state.items, [{ kind: "assistant", text: "done" }]);
});

test("a streamed reply is not duplicated when the message ends", () => {
	const message = { role: "assistant", content: [{ type: "text", text: "ab" }], stopReason: "stop" };
	const { state } = replay([
		{ type: "message_start", message },
		{ type: "message_update", assistantMessageEvent: { type: "text_start" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "a" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "b" } },
		{ type: "message_end", message },
	]);
	assert.deepEqual(state.items, [{ kind: "assistant", text: "ab" }]);
});

test("a delta with no text_start still opens a reply", () => {
	const { state } = replay([
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } },
	]);
	assert.deepEqual(state.items, [{ kind: "assistant", text: "x" }]);
});

test("a stream cut off mid-reply keeps what arrived", () => {
	const { state } = replay([
		{ type: "message_update", assistantMessageEvent: { type: "text_start" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "half" } },
		{ type: "agent_settled" },
	]);
	assert.deepEqual(
		state.items.map((i) => i.text ?? i.kind),
		["half", "done"],
	);
});

test("tool results attach by id, whatever order they finish in", () => {
	const start = (id, name) => ({ type: "tool_execution_start", toolCallId: id, toolName: name, args: {} });
	const end = (id, text) => ({
		type: "tool_execution_end",
		toolCallId: id,
		result: { content: [{ type: "text", text }] },
		isError: false,
	});
	const { state } = replay([start("a", "bash"), start("b", "read"), end("b", "second"), end("a", "first")]);

	assert.deepEqual(
		state.items.map((i) => [i.name, i.result]),
		[
			["bash", "first"],
			["read", "second"],
		],
	);
});

test("a tool result with no matching call is ignored", () => {
	const { state } = replay([{ type: "tool_execution_end", toolCallId: "gone", result: "x", isError: false }]);
	assert.deepEqual(state.items, []);
});

test("an empty user message is skipped by both paths", () => {
	const message = { role: "user", content: [{ type: "image", data: "…" }] };
	assert.deepEqual(replay([{ type: "message_start", message }]).state.items, []);
	assert.deepEqual(itemsFromMessages([message]), []);
});

test("a reply that calls a tool before speaking keeps one order", () => {
	// Content order is toolCall-then-text, but live the text streams first,
	// so the stored path has to match that rather than the array order.
	const messages = [
		{
			role: "assistant",
			stopReason: "toolUse",
			content: [
				{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
				{ type: "text", text: "checking" },
			],
		},
	];
	assert.deepEqual(
		itemsFromMessages(messages).map((i) => i.kind),
		["assistant", "tool"],
	);
});

test("work per event does not grow with conversation length", () => {
	const fresh = replay(TURN);
	const loaded = createConversation();
	// Twelve turns of history in front of the same stream.
	for (let i = 0; i < 12; i++) loaded.items.push(...structuredClone(fresh.state.items));
	const before = loaded.items.length;

	const touched = [];
	for (const event of TURN) {
		const { added, changed } = applyEvent(loaded, event);
		touched.push(added.length + changed.length);
	}

	assert.deepEqual(touched, fresh.touched);
	// Each event touches at most one item, so a renderer can stay incremental.
	assert.equal(Math.max(...touched), 1);
	assert.equal(loaded.items.length - before, fresh.state.items.length);
});
