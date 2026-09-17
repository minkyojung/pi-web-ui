/**
 * The three pieces asking is made of, without a server or a model: what pi is
 * sent, what of a run counts as an answer, and where in the note it goes.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { answerOf, asked, under } from "../ask.ts";

const said = (text, stopReason) => ({ role: "assistant", content: [{ type: "text", text }], ...(stopReason ? { stopReason } : {}) });

test("물음은 고른 글을 인용하고, 그 아래에 사람이 쓴 말을 둔다", () => {
  assert.equal(asked("고양이는 밤에 잘 본다", "왜 그렇지"), "> 고양이는 밤에 잘 본다\n\n왜 그렇지");
  assert.equal(asked("첫 줄\n둘째 줄", "무슨 뜻이야"), "> 첫 줄\n> 둘째 줄\n\n무슨 뜻이야");
});

test("답은 마지막으로 말한 것이고, 도구를 쓰다 만 말은 답이 아니다", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "왜 그렇지" }] },
    said("먼저 찾아볼게"),
    { role: "toolResult", content: [{ type: "text", text: "..." }] },
    said("어두운 곳에서도 빛을 모으기 때문이다."),
  ];
  assert.equal(answerOf(messages), "어두운 곳에서도 빛을 모으기 때문이다.");
});

test("멈춘 run과 실패한 run과 아무 말도 없는 run에는 답이 없다", () => {
  assert.equal(answerOf([said("절반쯤 쓰다", "aborted")]), null);
  assert.equal(answerOf([said("", "error")]), null);
  assert.equal(answerOf([said("   ")]), null);
  assert.equal(answerOf([]), null);
  assert.equal(answerOf([{ role: "user", content: [{ type: "text", text: "왜 그렇지" }] }]), null);
});

test("답은 고른 글이 끝나는 줄 아래에 제 문단으로 들어간다", () => {
  const text = "머리말\n\n고양이는 밤에 잘 본다\n\n맺음말\n";
  const to = text.indexOf("잘 본다") + "잘 본다".length;
  assert.equal(under(text, to, "빛을 더 모은다."), "머리말\n\n고양이는 밤에 잘 본다\n\n빛을 더 모은다.\n\n맺음말\n");
});

test("마지막 줄에 물으면 답은 노트 끝에 붙는다 — 줄바꿈이 있든 없든", () => {
  assert.equal(under("한 줄뿐", 3, "답"), "한 줄뿐\n\n답");
  assert.equal(under("한 줄뿐\n", 3, "답"), "한 줄뿐\n\n답\n");
});
