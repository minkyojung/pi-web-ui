import assert from "node:assert/strict";
import test from "node:test";

import { START, next, specCommand, specMessage } from "../web/src/firstSpec.ts";

const opus = { key: "anthropic/claude-opus-5", name: "Opus 5", levels: ["off", "low", "medium", "high"], level: "medium" };
const luna = { key: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", levels: ["off", "minimal", "low"], level: "low" };
const config = (model = opus.key, models = [opus, luna]) => ({ model, models, isStreaming: false, isCompacting: false });
const fine = { online: true, signedIn: true, hasCommand: true, config: config() };
const line = { line: "add a greeting", model: null, effort: null };

test("보내는 것은 사람이 치는 것과 같다", () => {
	assert.equal(specCommand("add a greeting"), "/spec add a greeting");
	assert.deepEqual(specMessage("add a greeting"), { type: "prompt", text: "/spec add a greeting", command: true, behavior: "followUp" });
});

test("고른 것이 없으면 바로 보낸다", () => {
	assert.deepEqual(next(line, fine, START).step, { do: "send", message: specMessage("add a greeting"), warning: null });
});

test("서버가 말하기 전에는 기다리고, 끝내 말이 없으면 줄은 메시지 상자로 간다", () => {
	for (const seen of [{ ...fine, online: false }, { ...fine, config: null }, { ...fine, signedIn: null }, { ...fine, hasCommand: false }, { ...fine, config: { ...config(), isStreaming: true } }]) {
		assert.deepEqual(next(line, seen, START).step, { do: "wait" });
		const late = next(line, seen, START, true).step;
		assert.equal(late.do, "draft");
		assert.equal(late.text, "/spec add a greeting");
	}
});

test("로그인 전이면 기다리지 않고 메시지 상자에 둔다", () => {
	const { step } = next(line, { ...fine, signedIn: false }, START);
	assert.equal(step.do, "draft");
	assert.equal(step.text, "/spec add a greeting");
	assert.match(step.why, /Sign in/);
});

test("모델을 맞추고, 맞춰진 것을 본 뒤에 effort를, 그것도 본 뒤에 보낸다", () => {
	const first = { line: "x", model: luna.key, effort: "minimal" };
	const one = next(first, fine, START);
	assert.deepEqual(one.step, { do: "set", message: { type: "set_model", model: luna.key } });
	// The server has not said so yet: nothing more is sent on top of it.
	assert.deepEqual(next(first, fine, one.progress).step, { do: "wait" });
	const onLuna = { ...fine, config: config(luna.key) };
	const two = next(first, onLuna, one.progress);
	assert.deepEqual(two.step, { do: "set", message: { type: "set_thinking", level: "minimal" } });
	assert.deepEqual(next(first, onLuna, two.progress).step, { do: "wait" });
	const atMinimal = { ...fine, config: config(luna.key, [opus, { ...luna, level: "minimal" }]) };
	assert.deepEqual(next(first, atMinimal, two.progress).step, { do: "send", message: specMessage("x"), warning: null });
});

test("이미 그 모델, 그 effort면 아무것도 맞추지 않는다", () => {
	assert.equal(next({ line: "x", model: opus.key, effort: "medium" }, fine, START).step.do, "send");
});

test("목록에 없는 모델은 묻지 않고 넘어가, 있던 모델로 시작하며 그렇게 말한다 — effort는 그 모델의 것이므로 같이 둔다", () => {
	const { step } = next({ line: "x", model: "nobody/none", effort: "high" }, fine, START);
	assert.equal(step.do, "send");
	assert.equal(step.warning, "nobody/none could not be used for this spec — it starts on Opus 5 at medium.");
});

test("맞춰 달라고 한 모델이 끝내 안 되면 있던 모델로 보낸다", () => {
	const first = { line: "x", model: luna.key, effort: null };
	const asked = next(first, fine, START).progress;
	const { step } = next(first, fine, asked, true);
	assert.equal(step.do, "send");
	assert.match(step.warning, /gpt-5\.6-luna could not be used/);
});

test("그 모델이 못 하는 effort는 묻지 않고, 끝내 안 되는 effort도 보내기를 막지 않는다", () => {
	const cannot = next({ line: "x", model: null, effort: "max" }, fine, START).step;
	assert.equal(cannot.do, "send");
	assert.match(cannot.warning, /^max could not be used/);
	const first = { line: "x", model: null, effort: "high" };
	const asked = next(first, fine, START);
	assert.deepEqual(asked.step, { do: "set", message: { type: "set_thinking", level: "high" } });
	assert.equal(next(first, fine, asked.progress, true).step.do, "send");
});
