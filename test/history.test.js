import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { apply, appendHistory, changesBetween, historyPath, readHistory, reconcile, record, replay } from "../history.ts";

const me = { author: "me", at: 1 };
const pi = { author: "pi", at: 2, sessionId: "s1", entryId: "e1" };

/** Replaying the changes must give `after` back; anything else is a wrong offset. */
const roundtrip = (before, after) => {
  const changes = changesBetween(before, after, me);
  let text = before;
  for (const c of changes) text = apply(text, c);
  assert.equal(text, after);
  return changes;
};

test("전과 후에서 나온 변경을 다시 적용하면 후가 된다", () => {
  roundtrip("", "hello");
  roundtrip("hello", "");
  roundtrip("hello world", "hello there world");
  roundtrip("hello world", "goodbye world");
  roundtrip("a\nb\nc\n", "a\nB\nc\nd\n");
  roundtrip("한글 문장입니다", "한글 긴 문장이다");
  roundtrip("emoji 🙂 here", "emoji 🙃 here");
});

test("지우고 넣은 것은 변경 하나다", () => {
  const changes = changesBetween("hello world", "goodbye world", me);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], { ...me, from: 0, to: 5, inserted: "goodbye", removed: "hello" });
});

test("같은 것은 변경이 없다", () => {
  assert.deepEqual(changesBetween("same", "same", me), []);
});

test("재생하면 누가 어느 글자를 썼는지 나온다", () => {
  const log = [
    ...changesBetween("", "hello world\n", me),
    ...changesBetween("hello world\n", "goodbye world\n", pi),
  ];
  const { text, spans } = replay(log);
  assert.equal(text, "goodbye world\n");
  assert.deepEqual(
    spans.map((s) => [s.author, text.slice(s.from, s.to)]),
    [["pi", "goodbye"], ["me", " world\n"]],
  );
});

test("단어 하나를 건드리면 그 단어가 통째로 고친 쪽 것이 된다 — 화면이 단어 단위라서", () => {
  const log = [
    ...changesBetween("", "goodbye big world", pi),
    ...changesBetween("goodbye big world", "goodBYE big world", { ...me, at: 3 }),
  ];
  const { text, spans } = replay(log);
  assert.deepEqual(
    spans.map((s) => [s.author, text.slice(s.from, s.to)]),
    [["me", "goodBYE"], ["pi", " big world"]],
  );
});

test("지운 글자는 구간에서 사라지고 뒤가 당겨진다", () => {
  const log = [
    ...changesBetween("", "one two three", me),
    ...changesBetween("one two three", "one three", pi),
  ];
  const { text, spans } = replay(log);
  assert.equal(text, "one three");
  assert.deepEqual(spans, [{ ...me, from: 0, to: 9 }]);
});

test("이웃한 같은 출처는 하나로 합쳐진다", () => {
  const log = [...changesBetween("", "ab", me), ...changesBetween("ab", "aXb", me)];
  assert.deepEqual(replay(log).spans, [{ ...me, from: 0, to: 3 }]);
});

test("구간 하나는 언제나 글자 하나 이상이고 서로 겹치지 않는다", () => {
  const steps = ["", "abc", "abXc", "aXc", "aXcYZ", "YZ", "Q"];
  const log = [];
  for (let i = 1; i < steps.length; i++) {
    log.push(...changesBetween(steps[i - 1], steps[i], i % 2 ? me : pi));
  }
  const { text, spans } = replay(log);
  assert.equal(text, "Q");
  let last = 0;
  for (const s of spans) {
    assert.ok(s.from >= last && s.to > s.from);
    last = s.to;
  }
  assert.equal(last, text.length, "구간들이 본문 전체를 덮는다");
});

// --- on disk ---

const DIR = mkdtempSync(join(tmpdir(), "history-"));
test.after(() => rmSync(DIR, { recursive: true, force: true }));

test("로그는 노트의 폴더를 따라 .pi/history 아래에 놓인다", () => {
  assert.equal(historyPath(DIR, "ideas/a.md"), join(DIR, ".pi/history/ideas/a.md.jsonl"));
});

test("덧붙인 것이 그대로 읽히고, 빈 로그는 빈 목록이다", () => {
  assert.deepEqual(readHistory(DIR, "x.md"), []);
  const changes = changesBetween("", "hi", me);
  appendHistory(DIR, "x.md", changes);
  appendHistory(DIR, "x.md", changesBetween("hi", "hi!", pi));
  assert.deepEqual(readHistory(DIR, "x.md"), [...changes, ...changesBetween("hi", "hi!", pi)]);
  assert.equal(readFileSync(historyPath(DIR, "x.md"), "utf8").split("\n").length, 3, "한 줄에 하나, 끝에 개행");
});

test("찢어진 마지막 줄은 버리고 그 앞은 살린다", () => {
  appendHistory(DIR, "torn.md", changesBetween("", "ok", me));
  writeFileSync(historyPath(DIR, "torn.md"), readFileSync(historyPath(DIR, "torn.md"), "utf8") + '{"from":0,"to":', { flag: "w" });
  assert.equal(readHistory(DIR, "torn.md").length, 1);
});

test("처음 보는 노트는 통째로 바깥 것으로 심어진다", () => {
  const { spans } = reconcile(DIR, "seed.md", "already here\n", 5);
  assert.deepEqual(spans, [{ author: "outside", at: 5, from: 0, to: 13 }]);
  assert.equal(existsSync(historyPath(DIR, "seed.md")), true);
});

test("앱을 거치지 않은 편집은 바깥 것으로 기록된다", () => {
  record(DIR, "ext.md", "", "mine\n", me);
  // Someone edits the file directly.
  const { spans } = reconcile(DIR, "ext.md", "mine, theirs\n", 9);
  const text = "mine, theirs\n";
  assert.deepEqual(
    spans.map((s) => [s.author, text.slice(s.from, s.to)]),
    [["me", "mine"], ["outside", ", theirs"], ["me", "\n"]],
  );
  assert.equal(replay(readHistory(DIR, "ext.md")).text, text, "로그가 디스크를 따라잡았다");
});

test("기록은 쓴 쪽이 본 것부터 재고, 그 결과가 디스크와 같다", () => {
  record(DIR, "rec.md", "", "draft\n", me);
  const changes = record(DIR, "rec.md", "draft\n", "draft, revised\n", pi);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].entryId, "e1");
  const { text, spans } = replay(readHistory(DIR, "rec.md"));
  assert.equal(text, "draft, revised\n");
  assert.deepEqual(spans.map((s) => s.author), ["me", "pi", "me"]);
});

test("같은 노트에 같은 것을 다시 기록해도 로그는 늘지 않는다", () => {
  record(DIR, "idem.md", "", "x\n", me);
  const before = readHistory(DIR, "idem.md").length;
  assert.deepEqual(record(DIR, "idem.md", "x\n", "x\n", pi), []);
  assert.equal(readHistory(DIR, "idem.md").length, before);
});
