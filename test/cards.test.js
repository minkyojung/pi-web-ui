/**
 * The cards a note's log makes, and where they sit in the note now.
 *
 * The invariant the whole thing rests on: replaying the log is the cards.
 * Nothing is kept anywhere else, so every test here goes through the log.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { appendCard, cardsIn, cardsOf, cardsPath, readCardLog } from "../cards.ts";
import { appendHistory, changesBetween } from "../history.ts";

const me = { author: "me", at: 1 };
const opened = (id, from, to, quote, log = 0) => ({ kind: "opened", id, at: 10, from, to, log, quote, question: "무슨 뜻이야" });
const answered = (id) => ({ kind: "answered", id, at: 11, text: "이런 뜻이다.", sessionId: "s1", entryId: "e1" });

test("열린 카드는 고른 글과 물음을 들고 나온다", () => {
  const [card] = cardsIn([opened("c1", 4, 7, "two")], []);
  assert.deepEqual(
    [card.id, card.from, card.to, card.quote, card.question],
    ["c1", 4, 7, "two", "무슨 뜻이야"],
  );
  assert.equal(card.answer, undefined);
});

test("답과 실패와 넣음과 해결은 그 카드에만 붙는다", () => {
  const cards = cardsIn(
    [
      opened("c1", 0, 3, "one"),
      opened("c2", 4, 7, "two"),
      answered("c1"),
      { kind: "placed", id: "c1", at: 12 },
      { kind: "resolved", id: "c1", at: 13 },
      { kind: "failed", id: "c2", at: 14, why: "interrupted" },
    ],
    [],
  );
  const [first, second] = cards;
  assert.equal(first.answer.text, "이런 뜻이다.");
  assert.deepEqual([first.answer.sessionId, first.answer.entryId], ["s1", "e1"]);
  assert.deepEqual([first.placed, first.resolved], [true, true]);
  assert.equal(second.failed, "interrupted");
  assert.equal(second.answer, undefined);
});

test("다시 물어 답이 오면 앞선 실패는 지워진다", () => {
  const [card] = cardsIn([opened("c1", 0, 3, "one"), { kind: "failed", id: "c1", at: 11, why: "failed" }, answered("c1")], []);
  assert.equal(card.failed, undefined);
  assert.equal(card.answer.text, "이런 뜻이다.");
});

test("지운 카드는 나오지 않고, 없는 카드에 대한 줄은 그냥 지나간다", () => {
  const cards = cardsIn(
    [opened("c1", 0, 3, "one"), { kind: "deleted", id: "c1", at: 12 }, { kind: "resolved", id: "c1", at: 13 }, answered("c9")],
    [],
  );
  assert.deepEqual(cards, []);
});

test("카드는 노트를 읽는 순서대로, 같은 자리면 열린 순서대로 온다", () => {
  const cards = cardsIn([opened("late", 9, 12, "z"), opened("c1", 0, 3, "a"), { ...opened("c2", 0, 3, "a"), at: 99 }], []);
  assert.deepEqual(cards.map((c) => c.id), ["c1", "c2", "late"]);
});

test("카드가 열린 뒤의 변경만큼 자리가 밀리고, 그 전의 변경은 세지 않는다", () => {
  const first = changesBetween("", "one two three", me);
  const later = changesBetween("one two three", "ONE one two three", me);
  const log = [...first, ...later];
  // 카드는 "two" 위에서, first까지만 쌓였을 때 열렸다.
  const [card] = cardsIn([opened("c1", 4, 7, "two", first.length)], log);
  assert.equal("ONE one two three".slice(card.from, card.to), "two");
});

test("고른 글이 지워진 카드는 떨어진 카드가 된다", () => {
  const first = changesBetween("", "one two three", me);
  const log = [...first, ...changesBetween("one two three", "one three", me)];
  const [card] = cardsIn([opened("c1", 4, 7, "two", first.length)], log);
  assert.equal(card.orphaned, true);
  assert.equal(card.from, card.to);
});

test("고쳐 쓴 글 위의 카드는 떨어지지 않는다", () => {
  const first = changesBetween("", "one two three", me);
  const log = [...first, ...changesBetween("one two three", "one TWO three", me)];
  const [card] = cardsIn([opened("c1", 4, 7, "two", first.length)], log);
  assert.equal(card.orphaned, undefined);
});

// --- on disk ---

const DIR = mkdtempSync(join(tmpdir(), "cards-"));
test.after(() => rmSync(DIR, { recursive: true, force: true }));

test("로그는 노트의 폴더를 따라 .pi/cards 아래에 놓이고, 덧붙인 것이 그대로 읽힌다", () => {
  appendCard(DIR, "folder/note.md", opened("c1", 0, 3, "one"));
  appendCard(DIR, "folder/note.md", answered("c1"));
  assert.equal(cardsPath(DIR, "folder/note.md"), join(DIR, ".pi/cards/folder/note.md.jsonl"));
  assert.deepEqual(readCardLog(DIR, "folder/note.md").map((e) => e.kind), ["opened", "answered"]);
  assert.deepEqual(readCardLog(DIR, "없는.md"), []);
});

test("찢어진 마지막 줄은 버리고 그 앞은 살린다", () => {
  appendCard(DIR, "torn.md", opened("c1", 0, 3, "one"));
  writeFileSync(cardsPath(DIR, "torn.md"), readFileSync(cardsPath(DIR, "torn.md"), "utf8") + '{"kind":"answ');
  assert.deepEqual(readCardLog(DIR, "torn.md").map((e) => e.kind), ["opened"]);
});

test("노트의 카드는 그 노트의 기록을 따라 자리를 잡는다", () => {
  const first = changesBetween("", "one two three", me);
  appendHistory(DIR, "both.md", first);
  appendCard(DIR, "both.md", opened("c1", 4, 7, "two", first.length));
  appendHistory(DIR, "both.md", changesBetween("one two three", "ONE one two three", me));
  const [card] = cardsOf(DIR, "both.md");
  assert.equal("ONE one two three".slice(card.from, card.to), "two");
});
