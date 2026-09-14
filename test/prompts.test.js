/**
 * A question of ours: out to the browser, and back as an answer or a cancel,
 * without a server or a browser.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { Cancelled, createPromptBridge } from "../prompts.ts";

const bridge = () => {
	const sent = [];
	const prompts = createPromptBridge((msg) => sent.push(msg));
	return { sent, prompts };
};
const question = { type: "select", question: "Which one?", options: ["a", "b"] };

test("물음은 브라우저로 나가고, 열린 물음 목록에 있으며, 답이 오면 그 답으로 끝나고 목록에서 빠진다", async () => {
	const { sent, prompts } = bridge();
	const asked = prompts.ask(question);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].type, "prompt_request");
	const { id } = sent[0].prompt;
	assert.ok(id, "an id was given");
	assert.deepEqual(sent[0].prompt, { ...question, id, pipeline: "pi-web-ui" });
	assert.deepEqual(prompts.open().map((p) => p.id), [id]);

	prompts.answer(id, "b", false);
	assert.equal(await asked, "b");
	assert.deepEqual(prompts.open(), []);
	assert.deepEqual(sent[1], { type: "prompt_dismiss", id, answer: "b", cancelled: false });
});

test("닫으면 Cancelled로 끝나고, 모든 브라우저가 닫힘을 듣는다", async () => {
	const { sent, prompts } = bridge();
	const asked = prompts.ask(question);
	const { id } = sent[0].prompt;
	prompts.answer(id, undefined, true);
	await assert.rejects(asked, Cancelled);
	assert.deepEqual(sent[1], { type: "prompt_dismiss", id, cancelled: true });
});

test("한 번 끝난 물음에 온 답은 버려진다: 다른 탭이 먼저 답했을 때", async () => {
	const { sent, prompts } = bridge();
	const asked = prompts.ask(question);
	const { id } = sent[0].prompt;
	prompts.answer(id, "a", false);
	prompts.answer(id, "b", false);
	prompts.answer(id, undefined, true);
	assert.equal(await asked, "a");
	assert.equal(sent.length, 2, "one request, one dismiss");
	assert.equal(prompts.answer("no-such-id", "x", false), undefined);
});

test("답 없는 답은 아무것도 하지 않는다", () => {
	const { sent, prompts } = bridge();
	prompts.ask(question);
	prompts.answer(sent[0].prompt.id, undefined, false);
	assert.equal(sent.length, 1);
	assert.equal(prompts.open().length, 1);
});

test("abort 전에는 열린 물음이 전부 Cancelled로 끝난다", async () => {
	const { sent, prompts } = bridge();
	const first = prompts.ask(question);
	const second = prompts.ask({ type: "input", question: "Name?" });
	prompts.cancelAll();
	await assert.rejects(first, Cancelled);
	await assert.rejects(second, Cancelled);
	assert.deepEqual(prompts.open(), []);
	assert.equal(sent.filter((m) => m.type === "prompt_dismiss").length, 2);
});

test("어댑터로 등록된 물음은 예전 길로 답한다: 우리 물음과 섞이지 않는다", async () => {
	const { sent, prompts } = bridge();
	// A bus as the dashboard's: it hands the adapter a responder, and calls
	// onRequest with its own questions.
	const responded = [];
	let onRequest;
	const bus = {
		emit: (_name, adapter) => {
			onRequest = adapter.onRequest.bind(adapter);
			adapter.setRespond((r) => responded.push(r));
			adapter.setCancel((id) => responded.push({ id, cancelled: true }));
		},
	};
	assert.equal(prompts.register(bus), true);
	onRequest({ id: "theirs", pipeline: "dashboard", type: "confirm", question: "Sure?" });
	const ours = prompts.ask(question);
	const oursId = sent.at(-1).prompt.id;

	prompts.answer("theirs", "true", false);
	assert.deepEqual(responded, [{ id: "theirs", answer: "true", source: "pi-web-ui" }]);
	prompts.answer(oursId, "a", false);
	assert.equal(await ours, "a");
	assert.equal(responded.length, 1, "our answer did not go to the bus");
});
