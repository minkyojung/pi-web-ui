import assert from "node:assert/strict";
import test from "node:test";

import { applyEvent, createConversation, itemsFromMessages } from "../conversation.js";

const think = (delta) => ({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta } });
const speak = (delta) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });

function replay(events) {
	const state = createConversation();
	for (const event of events) applyEvent(state, event);
	return state;
}

const shape = (items) => items.map((item) => [item.kind, item.text ?? item.name]);

test("a streamed thought becomes one item, separate from the answer", () => {
	const state = replay([
		{ type: "message_update", assistantMessageEvent: { type: "thinking_start" } },
		think("They want "),
		think("the thinking stream."),
		{ type: "message_update", assistantMessageEvent: { type: "thinking_end" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_start" } },
		speak("Here it is."),
	]);
	assert.deepEqual(shape(state.items), [
		["thinking", "They want the thinking stream."],
		["assistant", "Here it is."],
	]);
});

test("a delta with no start still opens a thought, the way text does", () => {
	assert.deepEqual(shape(replay([think("straight in")]).items), [["thinking", "straight in"]]);
});

test("a second message thinks into its own item", () => {
	const state = replay([
		think("first"),
		{ type: "message_end", message: { role: "assistant", content: [] } },
		think("second"),
	]);
	assert.deepEqual(shape(state.items), [
		["thinking", "first"],
		["thinking", "second"],
	]);
});

test("thinking and text interleave without landing in each other", () => {
	const state = replay([think("a"), speak("b"), think("c"), speak("d")]);
	assert.deepEqual(shape(state.items), [
		["thinking", "ac"],
		["assistant", "bd"],
	]);
});

test("a resumed message replays thought, then answer, then tools", () => {
	const items = itemsFromMessages([
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "t1", name: "ls", arguments: {} },
				{ type: "text", text: "Here it is." },
				{ type: "thinking", thinking: "They want the thinking stream." },
			],
		},
	]);
	// Content order says tool, text, thought; a live stream would have said
	// thought, text, tool, and the two paths have to agree.
	assert.deepEqual(shape(items), [
		["thinking", "They want the thinking stream."],
		["assistant", "Here it is."],
		["tool", "ls"],
	]);
});

test("live and resumed agree on a message that thought, spoke and called a tool", () => {
	const live = replay([
		{ type: "message_start", message: { role: "assistant", content: [] } },
		think("Look it up."),
		speak("Found it."),
		{ type: "tool_execution_start", toolCallId: "t1", toolName: "ls", args: {} },
	]);
	const resumed = itemsFromMessages([
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Look it up." },
				{ type: "text", text: "Found it." },
				{ type: "toolCall", id: "t1", name: "ls", arguments: {} },
			],
		},
	]);
	assert.deepEqual(shape(live.items), shape(resumed));
});

test("redacted thinking is carried by the provider, not shown", () => {
	const items = itemsFromMessages([
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "", thinkingSignature: "opaque", redacted: true },
				{ type: "text", text: "Answer." },
			],
		},
	]);
	assert.deepEqual(shape(items), [["assistant", "Answer."]]);
});

test("a thought does not end up in what the copy button copies", () => {
	const state = replay([
		{ type: "agent_start" },
		think("Not this."),
		speak("This."),
		{ type: "agent_settled" },
	]);
	assert.equal(state.items.at(-1).answer, "This.");
});
