/**
 * The tool pi asks with, without pi or a browser: what it mends in the
 * model's arguments, what it shows the card, and how it reads the answer.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { askUser, decode, decodeBatch, normalize, questionOf } from "../askUser.ts";
import { Cancelled } from "../prompts.ts";

test("모델이 이름을 틀려도 고쳐진다: question→title, 문자열 options, {label,value} 쌍, params 포장", () => {
	assert.deepEqual(normalize({ method: "select", question: "Which?", options: '["a","b"]' }), { method: "select", title: "Which?", options: ["a", "b"] });
	assert.deepEqual(normalize({ method: "select", header: "Which?", options: [{ label: "a", value: 1 }, { label: "b", value: 2 }] }), { method: "select", title: "Which?", options: ["a", "b"] });
	assert.deepEqual(normalize({ params: '{"method":"confirm","title":"Sure?"}' }), { method: "confirm", title: "Sure?" });
	assert.deepEqual(normalize({ params: { method: "input", title: "Name?" }, placeholder: "x" }), { method: "input", title: "Name?", placeholder: "x" });
	assert.deepEqual(normalize({ method: "input", input_type: { placeholder: "p" }, title: "T" }), { method: "input", placeholder: "p", title: "T" });
	assert.deepEqual(normalize("not an object"), "not an object");
	assert.deepEqual(normalize({ method: "select", options: "not json" }), { method: "select", options: "not json" }, "고칠 수 없는 것은 스키마가 거절하도록 둔다");
});

test("questions가 있으면 batch이고, 제목이 없으면 첫 질문의 것을 쓴다", () => {
	assert.deepEqual(normalize({ questions: [{ question: "A?", method: "confirm" }, { title: "B?", method: "input" }] }), {
		questions: [{ title: "A?", method: "confirm" }, { title: "B?", method: "input" }],
		method: "batch",
		title: "A?",
	});
	assert.deepEqual(normalize({ method: "batch", questions: '[{"title":"A?","method":"confirm"}]' }), { method: "batch", questions: [{ title: "A?", method: "confirm" }], title: "A?" });
	assert.equal(normalize({ method: "batch", questions: [{ method: "confirm" }] }).title, "Questions");
});

test("카드가 읽는 모양으로 나간다", () => {
	assert.deepEqual(questionOf({ method: "confirm", title: "Sure?", message: "Why" }), { type: "confirm", question: "Sure?", metadata: { message: "Why" } });
	assert.deepEqual(questionOf({ method: "select", title: "Which?", options: ["a", "b"] }), { type: "select", question: "Which?", options: ["a", "b"], metadata: { other: true } });
	assert.deepEqual(questionOf({ method: "multiselect", title: "Which?", options: ["a"] }), { type: "multiselect", question: "Which?", options: ["a"], metadata: { other: true } }, "고르는 물음에는 자기 말로 답할 자리가 있다");
	assert.deepEqual(questionOf({ method: "input", title: "Name?", placeholder: "e.g. Kim" }), { type: "input", question: "Name?", defaultValue: "e.g. Kim" });
	assert.deepEqual(questionOf({ method: "input", message: "only a message" }), { type: "input", question: "only a message", metadata: { message: "only a message" } });
	assert.deepEqual(
		questionOf({ method: "batch", title: "Setup", questions: [{ method: "select", title: "A?", options: ["x"] }, { method: "input", title: "B?", placeholder: "p" }] }),
		{ type: "batch", question: "Setup", metadata: { questions: [{ method: "select", title: "A?", options: ["x"], other: true }, { method: "input", title: "B?", placeholder: "p" }] } },
	);
});

test("답은 카드가 보내는 문자열에서 종류에 맞는 값으로 읽힌다", () => {
	assert.equal(decode("confirm", "true"), true);
	assert.equal(decode("confirm", "false"), false);
	assert.equal(decode("select", "b"), "b");
	assert.equal(decode("input", "hello"), "hello");
	assert.deepEqual(decode("multiselect", '["a","c"]'), ["a", "c"]);
	assert.deepEqual(decode("multiselect", "[]"), [], "아무것도 고르지 않은 것도 답이다");
	assert.deepEqual(decode("multiselect", "junk"), []);
	assert.deepEqual(decodeBatch('[{"confirmed":true},{"values":["a"]},{"value":"t"},7]'), [true, ["a"], "t", 7]);
	assert.deepEqual(decodeBatch("junk"), []);
});

/** pi, as far as the tool can tell: registerTool is the only thing it calls. */
const registered = (ask) => {
	let tool;
	askUser(() => ask)({ registerTool: (t) => { tool = t; } });
	return tool;
};

test("도구는 등록되고, 물음을 내고, 답을 pi에게 말한다", async () => {
	const asked = [];
	const tool = registered(async (q) => { asked.push(q); return q.type === "confirm" ? "true" : q.type === "multiselect" ? '["a"]' : "a"; });
	assert.equal(tool.name, "ask_user");
	const run = (args) => tool.execute("call-1", tool.prepareArguments(args), undefined, undefined, {});

	let out = await run({ method: "select", question: "Which?", options: '["a","b"]' });
	assert.deepEqual(asked.at(-1), { type: "select", question: "Which?", options: ["a", "b"], metadata: { other: true } });
	assert.equal(out.content[0].text, 'User responded: "a"');
	assert.deepEqual(out.details, { method: "select", result: "a", cancelled: false });

	out = await run({ method: "confirm", title: "Sure?" });
	assert.deepEqual(out.details, { method: "confirm", result: true, cancelled: false });

	out = await run({ method: "multiselect", title: "Many?", options: ["a", "b"] });
	assert.deepEqual(out.details, { method: "multiselect", result: ["a"], cancelled: false });

	out = await run({ method: "input", title: "Name?" });
	assert.deepEqual(out.details, { method: "input", result: "a", cancelled: false });
});

test("batch는 질문마다 한 답이고, 보고는 번호가 매겨진다", async () => {
	const tool = registered(async () => '[{"confirmed":false},{"value":"Kim"}]');
	const out = await tool.execute("c", tool.prepareArguments({ questions: [{ method: "confirm", title: "Sure?" }, { method: "input", title: "Name?" }] }), undefined, undefined, {});
	assert.deepEqual(out.details, { method: "batch", results: [false, "Kim"], cancelled: false });
	assert.equal(out.content[0].text, 'User completed batch (2 answers).\n  1. Sure?: false\n  2. Name?: "Kim"');
});

test("닫힌 물음은 오류가 아니라 답하지 않았다는 결과다", async () => {
	const tool = registered(async () => { throw new Cancelled(); });
	const out = await tool.execute("c", { method: "input", title: "Name?" }, undefined, undefined, {});
	assert.deepEqual(out.details, { method: "input", cancelled: true });
	assert.match(out.content[0].text, /without answering/);
});

test("고를 것이 없는 select는 모델에게 되돌아간다, 카드로 가지 않고", async () => {
	let asked = 0;
	const tool = registered(async () => { asked++; return "a"; });
	await assert.rejects(tool.execute("c", { method: "select", title: "Which?", options: ["only one"] }, undefined, undefined, {}), /at least 2/);
	await assert.rejects(tool.execute("c", { method: "multiselect", title: "Which?" }, undefined, undefined, {}), /at least 1/);
	await assert.rejects(tool.execute("c", { method: "batch", questions: [] }, undefined, undefined, {}), /at least one/);
	await assert.rejects(tool.execute("c", { method: "batch", questions: [{ method: "select", title: "A?", options: [] }] }, undefined, undefined, {}), /batch question 1/);
	assert.equal(asked, 0);
});
