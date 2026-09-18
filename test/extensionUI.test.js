/**
 * The screen an extension is given: its questions come up as ask_user's
 * card, what it says goes into the conversation, and what it would draw on a
 * terminal is taken and put nowhere — without throwing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { extensionUI } from "../extensionUI.ts";
import { createPromptBridge } from "../prompts.ts";

const screen = () => {
	const sent = [];
	const prompts = createPromptBridge((msg) => sent.push(msg));
	return { sent, prompts, ui: extensionUI(prompts, (msg) => sent.push(msg)) };
};
const asked = (sent) => sent.findLast((m) => m.type === "prompt_request").prompt;

test("select, confirm, input, editor는 ask_user의 카드로 나가고 답이 그대로 돌아온다", async () => {
	const { sent, prompts, ui } = screen();
	const chosen = ui.select("Which?", ["a", "b"]);
	assert.deepEqual(asked(sent), { ...asked(sent), type: "select", question: "Which?", options: ["a", "b"] });
	assert.equal(asked(sent).metadata?.other, undefined, "확장은 내놓은 것 중 하나를 돌려받는다고 믿는다: 자기 말로 답할 자리는 없다");
	prompts.answer(asked(sent).id, "b", false);
	assert.equal(await chosen, "b");

	const sure = ui.confirm("Delete?", "It is gone after.");
	assert.equal(asked(sent).type, "confirm");
	assert.equal(asked(sent).metadata.message, "It is gone after.");
	prompts.answer(asked(sent).id, "true", false);
	assert.equal(await sure, true);

	const typed = ui.input("Name?", "untitled");
	assert.equal(asked(sent).defaultValue, "untitled");
	prompts.answer(asked(sent).id, "notes", false);
	assert.equal(await typed, "notes");

	const edited = ui.editor("Edit", "draft");
	assert.equal(asked(sent).type, "editor");
	prompts.answer(asked(sent).id, "draft 2", false);
	assert.equal(await edited, "draft 2");
});

test("닫힌 물음은 pi의 헤드리스 호스트와 같은 기본값으로 답한다 — 고르기와 입력은 없음, 확인은 아니오", async () => {
	const { sent, prompts, ui } = screen();
	const chosen = ui.select("Which?", ["a"]);
	prompts.answer(asked(sent).id, undefined, true);
	assert.equal(await chosen, undefined);
	const sure = ui.confirm("Sure?", "");
	prompts.answer(asked(sent).id, undefined, true);
	assert.equal(await sure, false);
	assert.equal(await ui.input("Name?", undefined, { timeout: 5 }), undefined);
});

test("notify는 대화로 간다 — error는 오류로, 나머지는 알림으로", () => {
	const { sent, ui } = screen();
	ui.notify("Saved", "info");
	ui.notify("Careful", "warning");
	ui.notify("Broke", "error");
	assert.deepEqual(sent, [
		{ type: "notice", text: "Saved" },
		{ type: "notice", text: "Careful" },
		{ type: "error", message: "Broke" },
	]);
});

test("터미널의 것들은 아무 일도 하지 않되 던지지 않고, 테마는 글을 돌려준다", async () => {
	const { ui } = screen();
	ui.setWidget("k", ["line"]);
	ui.setStatus("k", "text");
	ui.setTitle("t");
	assert.equal(ui.getEditorText(), "");
	assert.equal(await ui.custom(() => {}), undefined);
	assert.equal(ui.setTheme("dark").success, false);
	assert.ok(ui.theme.fg("accent", "hello").includes("hello"));
	assert.ok(ui.theme.bg("selectedBg", "hello").includes("hello"));
	assert.equal(ui.theme.bold("x").length > 0, true);
});
