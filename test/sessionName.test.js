import assert from "node:assert/strict";
import test from "node:test";

import { INSTRUCTIONS, NOTHING, WORDS, asking, cheapest, nameFrom } from "../sessionName.ts";

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

test("이름이 아직 없다는 대답은 이름이 아니다 — 대소문자, 마침표가 붙어도", () => {
  assert.equal(nameFrom(NOTHING), undefined);
  assert.equal(nameFrom("None."), undefined);
  assert.equal(nameFrom("**NONE**"), undefined);
  assert.equal(nameFrom("None of Them"), "None of Them");
});

const said = [
  { role: "user", text: "리듀서를 다시 써줘" },
  { role: "assistant", text: "이렇게 쓰면 됩니다" },
  { role: "user", text: "테스트도" },
];

test("모델에게 보이는 대화에는 지금까지 주고받은 말이 다 들어가고, 태그 안에 있다", () => {
  const text = asking(said);
  assert.match(text, /^<conversation>\n[\s\S]*\n<\/conversation>$/);
  for (const s of said) assert.ok(text.includes(s.text), s.text);
});

test("이름을 지으라는 말은 대화 쪽에 섞이지 않는다 — 섞이면 대화가 빈약할 때 그 말에 이름이 붙는다", () => {
  const text = asking(said);
  assert.doesNotMatch(text, /name/i);
  assert.match(INSTRUCTIONS, new RegExp(`at most ${WORDS} words`));
  assert.ok(INSTRUCTIONS.includes(NOTHING), "지을 게 없을 때의 대답을 알려준다");
});

test("긴 대화는 잘라서 보낸다 — 이름 세 단어에 대화 전체를 실어 보낼 이유가 없다", () => {
  const long = "가".repeat(5000);
  const text = asking([{ role: "user", text: long }, { role: "assistant", text: long }]);
  assert.ok(text.length < 5000, "잘렸다");
  assert.match(text, /…\n<\/conversation>$/);
});
