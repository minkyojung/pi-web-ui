import assert from "node:assert/strict";
import test from "node:test";

import { LIMIT, PER_NOTE, excerpt, search } from "../search.ts";

const at = (hit) => hit.text.slice(hit.from, hit.to);

test("대소문자를 가리지 않는 부분 일치이고, 줄 번호와 일치 위치를 준다", () => {
  const hits = search([{ path: "a.md", text: "# Title\n\nThe Needle is here\n" }], "needle");
  assert.deepEqual(hits.map((h) => [h.path, h.line, h.text, at(h)]), [["a.md", 3, "The Needle is here", "Needle"]]);
  assert.equal(search([{ path: "a.md", text: "ÉTÉ" }], "été").length, 1);
  assert.equal(at(search([{ path: "a.md", text: "x İstanbul needle" }], "NEEDLE")[0]), "needle", "소문자로 길이가 바뀌는 글자 뒤에서도 위치가 맞다");
});

test("빈 검색어는 아무것도 찾지 않고, 앞뒤 공백은 떼며, 정규식 글자는 글자 그대로다", () => {
  assert.deepEqual(search([{ path: "a.md", text: "anything" }], "   "), []);
  assert.equal(search([{ path: "a.md", text: "a word" }], "  word ").length, 1);
  assert.equal(search([{ path: "a.md", text: "[[link]] (x) a.b" }], "(x)").length, 1);
  assert.equal(search([{ path: "a.md", text: "axb" }], "a.b").length, 0);
});

test("한 줄에 하나, 한 노트에 여러 줄, 노트는 받은 순서대로", () => {
  const hits = search(
    [
      { path: "b.md", text: "cat\r\ncat cat\n" },
      { path: "a.md", text: "no\nconcatenate" },
    ],
    "cat",
  );
  assert.deepEqual(hits.map((h) => [h.path, h.line]), [["b.md", 1], ["b.md", 2], ["a.md", 2]]);
  assert.equal(hits[0].text, "cat", "줄 끝의 \\r은 문맥에 들지 않는다");
});

test("노트당 최대 3개, 전체 최대 50개이고, 다 차면 남은 노트는 읽지 않는다", () => {
  const many = Array.from({ length: 10 }, () => "hit").join("\n");
  assert.equal(search([{ path: "a.md", text: many }], "hit").length, PER_NOTE);
  let read = 0;
  function* notes() {
    for (let i = 0; i < 100; i++) {
      read++;
      yield { path: `${i}.md`, text: many };
    }
  }
  const hits = search(notes(), "hit");
  assert.equal(hits.length, LIMIT);
  assert.equal(read, Math.ceil(LIMIT / PER_NOTE));
});

test("긴 줄은 일치 둘레로 잘리고 잘린 쪽에 …이 붙으며, 위치는 잘린 문맥 안에서 맞다", () => {
  const line = "a".repeat(300) + "NEEDLE" + "b".repeat(300);
  const [hit] = search([{ path: "a.md", text: line }], "needle");
  assert.ok(hit.text.startsWith("…") && hit.text.endsWith("…"));
  assert.equal(at(hit), "NEEDLE");
  assert.ok(hit.text.length <= 122);
  // Near the start: nothing cut before it.
  const early = excerpt("NEEDLE" + "b".repeat(300), 0, 6);
  assert.equal(early.text.startsWith("NEEDLE"), true);
  assert.equal(early.text.endsWith("…"), true);
  // Near the end: the window slides back so the row is still full.
  const late = excerpt("a".repeat(300) + "NEEDLE", 300, 306);
  assert.equal(late.text.endsWith("NEEDLE"), true);
  assert.equal(late.text.slice(late.from, late.to), "NEEDLE");
  assert.equal(late.text.length, 121);
  // Short lines are whole.
  assert.deepEqual(excerpt("short NEEDLE", 6, 12), { text: "short NEEDLE", from: 6, to: 12 });
});

test("자르는 자리가 이모지의 한가운데면 이모지를 통째로 둔다", () => {
  // Odd lengths either side put both cuts on the second half of a pair.
  const line = "😀".repeat(200);
  const cut = excerpt(line, 81, 83);
  assert.equal(cut.text.isWellFormed(), true);
  assert.equal(cut.text.slice(cut.from, cut.to), line.slice(81, 83));
  const [hit] = search([{ path: "a.md", text: "😀".repeat(100) + "NEEDLE!" + "😀".repeat(100) }], "needle!");
  assert.equal(at(hit), "NEEDLE!");
  assert.equal(hit.text.isWellFormed(), true);
});
