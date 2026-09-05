import assert from "node:assert/strict";
import test from "node:test";

import { batchQuestions, encodeAnswer, encodeBatchAnswer } from "../web/src/promptAnswer.ts";

// The shapes below are what the dashboard extension's own decoders read
// (tui-prompt-adapter.ts, multiselect-decode.ts, its batch decoder). A wrong
// shape does not error there — it quietly becomes "no answer".

test("select, input and editor answer with the text itself", () => {
	assert.equal(encodeAnswer("select", "blue"), "blue");
	assert.equal(encodeAnswer("input", "hello there"), "hello there");
	assert.equal(encodeAnswer("editor", "line 1\nline 2"), "line 1\nline 2");
});

test("confirm answers with the strings true and false", () => {
	assert.equal(encodeAnswer("confirm", true), "true");
	assert.equal(encodeAnswer("confirm", false), "false");
});

test("multiselect answers with a JSON array, and an empty pick is a real answer", () => {
	assert.equal(encodeAnswer("multiselect", ["a", "b"]), '["a","b"]');
	// Distinct from cancelling, which never goes through encodeAnswer at all.
	assert.equal(encodeAnswer("multiselect", []), "[]");
});

test("a batch answer is a JSON array aligned by index, one shape per method", () => {
	const questions = [
		{ method: "confirm", title: "Proceed?" },
		{ method: "select", title: "Which?", options: ["x", "y"] },
		{ method: "multiselect", title: "Pick some", options: ["p", "q", "r"] },
		{ method: "input", title: "Name?" },
	];
	assert.deepEqual(JSON.parse(encodeBatchAnswer(questions, [true, "y", ["p", "r"], "Ada"])), [
		{ confirmed: true },
		{ value: "y" },
		{ values: ["p", "r"] },
		{ value: "Ada" },
	]);
});

test("a missing batch value degrades to the empty form rather than breaking alignment", () => {
	const questions = [
		{ method: "confirm", title: "a" },
		{ method: "multiselect", title: "b", options: [] },
		{ method: "input", title: "c" },
	];
	assert.deepEqual(JSON.parse(encodeBatchAnswer(questions, [])), [{ confirmed: false }, { values: [] }, { value: "" }]);
});

test("batchQuestions reads metadata.questions and drops what it cannot use", () => {
	const prompt = {
		id: "1",
		pipeline: "command",
		type: "batch",
		question: "Setup",
		metadata: {
			questions: [
				{ method: "input", title: "Name", placeholder: "e.g. Ada" },
				{ method: "select", title: "Colour", options: ["red", 42, "blue"] },
				{ method: "dance", title: "not a method" },
				null,
				{ method: "confirm" },
			],
		},
	};
	assert.deepEqual(batchQuestions(prompt), [
		{ method: "input", title: "Name", message: undefined, options: undefined, placeholder: "e.g. Ada" },
		{ method: "select", title: "Colour", message: undefined, options: ["red", "blue"], placeholder: undefined },
		{ method: "confirm", title: "Question", message: undefined, options: undefined, placeholder: undefined },
	]);
	assert.deepEqual(batchQuestions({ id: "2", pipeline: "command", type: "batch", question: "x" }), []);
});
