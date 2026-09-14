import assert from "node:assert/strict";
import test from "node:test";

import { WORDS, asking, cheapest, nameFrom } from "../sessionName.ts";

const model = (name, input, output) => ({ name, cost: { input, output } });

test("가장 싼 모델은 들고 나는 값을 더해서 고른다 — 하나만 싼 것에 속지 않는다", () => {
  const cheap = model("cheap", 1, 2);
  const lopsided = model("lopsided", 0, 100);
  assert.equal(cheapest([model("dear", 10, 20), cheap, lopsided]).name, "cheap");
  assert.equal(cheapest([cheap]).name, "cheap");
});

test("고를 모델이 없으면 없는 것이다 — 이름을 짓지 않을 뿐 터지지 않는다", () => {
  assert.equal(cheapest([]), undefined);
});

test("이름은 첫 줄에서, 세 단어까지만", () => {
  assert.equal(nameFrom("Reading list"), "Reading list");
  assert.equal(nameFrom("Rewriting the reducer twice over"), "Rewriting the reducer");
  assert.equal(nameFrom("Reading list\n그 다음 줄은 읽지 않는다"), "Reading list");
});

test("모델이 이름을 꾸며서 내놓아도 이름만 남는다 — 따옴표, 마침표, 굵게", () => {
  assert.equal(nameFrom('"Reading list"'), "Reading list");
  assert.equal(nameFrom("**Reading list**"), "Reading list");
  assert.equal(nameFrom("Reading list."), "Reading list");
  assert.equal(nameFrom("  “Reading list”  \n"), "Reading list");
});

test("이름이 없는 대답은 이름이 아니다 — 빈 것, 공백뿐인 것, 문장부호뿐인 것", () => {
  assert.equal(nameFrom(""), undefined);
  assert.equal(nameFrom("\n  \n\t"), undefined);
  assert.equal(nameFrom("..."), undefined);
});

test("물어보는 말에는 단어 수와 주고받은 것이 다 들어간다", () => {
  const text = asking("리듀서를 다시 써줘", "이렇게 쓰면 됩니다");
  assert.match(text, new RegExp(`at most ${WORDS} words`));
  assert.match(text, /리듀서를 다시 써줘/);
  assert.match(text, /이렇게 쓰면 됩니다/);
});

test("긴 메시지는 잘라서 보낸다 — 이름 세 단어에 대화 전체를 실어 보낼 이유가 없다", () => {
  const long = "가".repeat(5000);
  const text = asking(long, long);
  assert.ok(text.length < 5000, "두 쪽 다 잘렸다");
  assert.match(text, /…/);
});
