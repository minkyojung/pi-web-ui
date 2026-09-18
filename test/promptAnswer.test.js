import assert from "node:assert/strict";
import test from "node:test";

import { answerOf, batchQuestions, encodeAnswer, encodeAnswers, encodeBatchAnswer, questionsOf } from "../web/src/promptAnswer.ts";

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
				{ method: "select", title: "Colour", options: ["red", 42, "blue"], other: true },
				{ method: "dance", title: "not a method" },
				null,
				{ method: "confirm" },
			],
		},
	};
	assert.deepEqual(batchQuestions(prompt), [
		{ method: "input", title: "Name", message: undefined, options: undefined, placeholder: "e.g. Ada", other: false },
		{ method: "select", title: "Colour", message: undefined, options: ["red", "blue"], placeholder: undefined, other: true },
		{ method: "confirm", title: "Question", message: undefined, options: undefined, placeholder: undefined, other: false },
	]);
	assert.deepEqual(batchQuestions({ id: "2", pipeline: "command", type: "batch", question: "x" }), []);
});

test("a question alone is read the way a batch's questions are", () => {
	const select = { id: "1", pipeline: "octave", type: "select", question: "Which?", options: ["a", "b"], metadata: { message: "Why", other: true } };
	assert.deepEqual(questionsOf(select), [{ method: "select", title: "Which?", message: "Why", options: ["a", "b"], placeholder: undefined, other: true }]);
	// An extension's select carries no mark, and is given no line to write in.
	assert.equal(questionsOf({ id: "2", pipeline: "octave", type: "select", question: "Which?", options: ["a"] })[0].other, false);
	assert.equal(questionsOf({ id: "3", pipeline: "octave", type: "input", question: "Name?", defaultValue: "e.g. Ada" })[0].placeholder, "e.g. Ada");
	assert.deepEqual(questionsOf({ id: "4", pipeline: "octave", type: "editor", question: "Edit", defaultValue: "draft" }), []);
	assert.equal(questionsOf({ id: "5", pipeline: "octave", type: "batch", question: "Setup", metadata: { questions: [{ method: "confirm", title: "Sure?" }] } }).length, 1);
});

test("an answer is read from the choices taken, by their place, and the line written in", () => {
	const none = { picked: [], written: null };
	assert.equal(answerOf({ method: "confirm", title: "" }, { picked: [0], written: null }), true);
	assert.equal(answerOf({ method: "confirm", title: "" }, { picked: [1], written: null }), false);
	assert.equal(answerOf({ method: "confirm", title: "" }, none), false);

	const select = { method: "select", title: "", options: ["same", "same", "other"] };
	assert.equal(answerOf(select, { picked: [1], written: null }), "same", "the same words offered twice are still a choice");
	assert.equal(answerOf(select, { picked: [], written: "my own" }), "my own");
	assert.equal(answerOf(select, { picked: [], written: "2" }), "2", "a number written is the text, not the third choice");
	assert.equal(answerOf(select, { picked: [9], written: null }), "", "a place that is not there is no choice");
	assert.equal(answerOf(select, none), "");

	const many = { method: "multiselect", title: "", options: ["a", "b", "c"] };
	assert.deepEqual(answerOf(many, { picked: [0, 2], written: null }), ["a", "c"]);
	assert.deepEqual(answerOf(many, { picked: [1], written: "d" }), ["b", "d"], "what is written is one more of them");
	assert.deepEqual(answerOf(many, none), [], "passed over is none, which is an answer");

	assert.equal(answerOf({ method: "input", title: "" }, { picked: [], written: "hello" }), "hello");
	assert.equal(answerOf({ method: "input", title: "" }, none), "");
});

test("the answers go out in the one shape or the batch's, by the kind of prompt", () => {
	const one = { id: "1", pipeline: "octave", type: "multiselect", question: "Many?", options: ["a", "b"] };
	assert.equal(encodeAnswers(one, questionsOf(one), [["a"]]), '["a"]');
	const sure = { id: "2", pipeline: "octave", type: "confirm", question: "Sure?" };
	assert.equal(encodeAnswers(sure, questionsOf(sure), [true]), "true");
	const batch = { id: "3", pipeline: "octave", type: "batch", question: "Setup", metadata: { questions: [{ method: "confirm", title: "A?" }, { method: "select", title: "B?", options: ["x", "y"] }, { method: "input", title: "C?" }] } };
	const questions = questionsOf(batch);
	const values = [{ picked: [0], written: null }, { picked: [], written: null }, { picked: [], written: "t" }].map((f, i) => answerOf(questions[i], f));
	assert.equal(encodeAnswers(batch, questions, values), '[{"confirmed":true},{"value":""},{"value":"t"}]', "one passed over keeps its place");
});
