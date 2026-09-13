import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { apply, appendHistory, changesBetween, decide, historyPath, mapThrough, moveHistory, readHistory, reconcile, record, replay } from "../history.ts";

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
  assert.deepEqual(spans, [{ ...me, from: 0, to: 9 }], "잘린 구간은 뺀 글을 잃는다");
});

test("이웃한 같은 출처는 하나로 합쳐지고, 합쳐진 것은 통째가 아니다", () => {
  const log = [...changesBetween("", "ab ", me), ...changesBetween("ab ", "ab cd", me)];
  assert.deepEqual(replay(log).spans, [{ ...me, from: 0, to: 5 }]);
});

test("구간은 그 변경이 뺀 글을 통째일 때만 들고 있다", () => {
  const log = [
    ...changesBetween("", "hello world", me),
    ...changesBetween("hello world", "goodbye world", pi),
  ];
  const [first] = replay(log).spans;
  assert.equal(first.author, "pi");
  assert.equal(first.removed, "hello", "되돌리면 hello가 된다");
  // The person changes a word in the middle of what pi wrote: the pieces on
  // either side are not the whole insertion any more.
  log.push(...changesBetween("goodbye world", "goodbye big world", { ...pi, at: 3 }));
  log.push(...changesBetween("goodbye big world", "goodbye BIG world", { ...me, at: 4 }));
  const left = replay(log).spans.filter((s) => s.at === 3);
  assert.ok(left.length >= 1);
  assert.ok(left.every((s) => s.removed === undefined));
});

test("받아들이면 구간은 pi 것인 채로 accepted가 되고, 그 안팎이 갈린다", () => {
  const log = [
    ...changesBetween("", "one two three", pi),
    { ...me, at: 5, from: 4, to: 7, inserted: "two", removed: "two" },
  ];
  const { text, spans } = replay(log);
  assert.equal(text, "one two three");
  assert.deepEqual(
    spans.map((s) => [s.author, text.slice(s.from, s.to), s.accepted ?? false]),
    [["pi", "one ", false], ["pi", "two", true], ["pi", " three", false]],
  );
});

test("받아들인 구간은 뒤에 오는 편집을 따라 움직인다", () => {
  const log = [
    ...changesBetween("", "one two three", pi),
    { ...me, at: 5, from: 4, to: 7, inserted: "two", removed: "two" },
    ...changesBetween("one two three", "ONE one two three", { ...me, at: 6 }),
  ];
  const { text, spans } = replay(log);
  const accepted = spans.find((s) => s.accepted);
  assert.equal(text.slice(accepted.from, accepted.to), "two");
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

// --- removals: what pi took away that nothing replaced ---

test("pi가 지우기만 한 글은 구간은 없지만 자리 하나로 남는다", () => {
  const log = [...changesBetween("", "one two three", me), ...changesBetween("one two three", "one three", pi)];
  const { text, spans, removals } = replay(log);
  assert.equal(text, "one three");
  assert.deepEqual(spans.map((s) => s.author), ["me"], "구간은 me 것 하나뿐");
  assert.deepEqual(removals, [{ ...pi, pos: 4, removed: "two " }]);
});

test("사람이 지운 것과 바꿔 쓴 것은 자리로 남지 않는다 — 결정할 것이 없으니", () => {
  const cut = [...changesBetween("", "a b c", pi), ...changesBetween("a b c", "a c", me)];
  assert.deepEqual(replay(cut).removals, []);
  const swapped = [...changesBetween("", "a b c", me), ...changesBetween("a b c", "a X c", pi)];
  assert.deepEqual(replay(swapped).removals, [], "바꿔 쓴 것의 뺀 글은 구간이 들고 있다");
  assert.equal(replay(swapped).spans.find((s) => s.author === "pi").removed, "b");
});

test("자리는 뒤의 편집을 따라 움직이고, 그 자리를 덮는 편집에는 접힌다", () => {
  const log = [...changesBetween("", "one two three", me), ...changesBetween("one two three", "one three", pi)];
  assert.equal(replay([...log, ...changesBetween("one three", "ZERO one three", me)]).removals[0].pos, 4 + "ZERO ".length);
  assert.equal(replay([...log, ...changesBetween("one three", "one three four", me)]).removals[0].pos, 4, "뒤에서 일어난 편집엔 안 움직인다");
  assert.equal(replay([...log, ...changesBetween("one three", "X", me)]).removals[0].pos, 1, "덮이면 그 자리 끝으로");
});

test("폭 없는 결정이 그 자리의 삭제를 수락하고, 반대로 무른다", () => {
  const log = [...changesBetween("", "one two three", me), ...changesBetween("one two three", "one three", pi)];
  const at = replay(log).removals[0].pos;
  const kept = [...log, { ...me, at: 9, from: at, to: at, inserted: "", removed: "", kept: true }];
  assert.equal(replay(kept).removals[0].accepted, true);
  const back = [...kept, { ...me, at: 10, from: at, to: at, inserted: "", removed: "", kept: false }];
  assert.equal(replay(back).removals[0].accepted, undefined);
  assert.equal(replay(log).spans.length, replay(kept).spans.length, "구간은 건드리지 않는다");
});

test("범위 있는 결정도 그 안에 놓인 삭제를 함께 결정한다", () => {
  const log = [...changesBetween("", "one two three", me), ...changesBetween("one two three", "one three", pi)];
  const at = replay(log).removals[0].pos;
  const around = [...log, { ...me, at: 9, from: at - 1, to: at + 1, inserted: "e t", removed: "e t", kept: true }];
  assert.equal(replay(around).removals[0].accepted, true);
  const elsewhere = [...log, { ...me, at: 9, from: 0, to: 2, inserted: "on", removed: "on", kept: true }];
  assert.equal(replay(elsewhere).removals[0].accepted, undefined);
});

test("자리는 앞에서 일어난 변경만큼 밀리고, 뒤에서 일어난 변경에는 안 움직인다", () => {
  const text = "one two three";
  const before = changesBetween(text, "ONE one two three", me);
  const after = changesBetween(text, "one two three four", me);
  const at = text.indexOf("two");
  assert.equal(mapThrough(before, at), at + "ONE ".length);
  assert.equal(mapThrough(after, at), at);
  assert.equal(mapThrough([], at), at);
});

test("고른 글이 지워지면 두 끝이 만난다 — 답을 달아 줄 자리가 없어진 것", () => {
  const text = "one two three";
  const from = text.indexOf("two");
  const to = from + "two".length;
  const gone = changesBetween(text, "one three", me);
  assert.equal(mapThrough(gone, from), mapThrough(gone, to));
  // 고쳐 쓴 것은 없어진 것이 아니다: 자리는 그대로 남는다.
  const rewritten = changesBetween(text, "one TWO three", me);
  assert.ok(mapThrough(rewritten, from) < mapThrough(rewritten, to));
});

test("받아들임은 글을 바꾸지 않으니 자리도 움직이지 않는다", () => {
  const touch = [{ ...me, from: 0, to: 3, inserted: "one", removed: "one" }];
  assert.equal(mapThrough(touch, 8), 8);
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
  assert.deepEqual(spans, [{ author: "outside", at: 5, from: 0, to: 13, removed: "" }]);
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

test("누구 것인지 말해주면 그 이름으로 기록된다", () => {
  record(DIR, "claimed.md", "", "mine\n", me);
  const { appended } = reconcile(DIR, "claimed.md", "mine, pi's\n", 11, pi);
  assert.deepEqual(appended.map((c) => [c.author, c.sessionId, c.entryId]), [["pi", "s1", "e1"]]);
  const text = "mine, pi's\n";
  assert.deepEqual(
    replay(readHistory(DIR, "claimed.md")).spans.map((s) => [s.author, text.slice(s.from, s.to)]),
    [["me", "mine"], ["pi", ", pi's"], ["me", "\n"]],
    "바뀐 낱말만 pi의 것이다",
  );
});

test("처음 보는 노트도 말해준 이름으로 통째로 심어진다", () => {
  const { spans } = reconcile(DIR, "seeded-pi.md", "all of it\n", 12, pi);
  assert.deepEqual(spans.map((s) => s.author), ["pi"], "recorder가 이 경우를 가려내는 근거");
});

test("따라잡을 것이 없으면 아무것도 붙지 않는다", () => {
  reconcile(DIR, "twice.md", "once\n", 13, pi);
  const before = readHistory(DIR, "twice.md").length;
  const { appended } = reconcile(DIR, "twice.md", "once\n", 14, pi);
  assert.deepEqual(appended, []);
  assert.equal(readHistory(DIR, "twice.md").length, before, "감시기가 이미 한 일을 recorder가 되풀이하지 않는다");
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

test("accept는 지금 글 위의 범위를 빈 교체로 남긴다", () => {
  record(DIR, "acc.md", "", "pi wrote this\n", pi);
  decide(DIR, "acc.md", 3, 8, 7, true);
  const { spans } = replay(readHistory(DIR, "acc.md"));
  assert.deepEqual(spans.map((s) => [s.accepted ?? false, s.author]), [[false, "pi"], [true, "pi"], [false, "pi"]]);
  decide(DIR, "acc.md", 5, 5, 8, true);
  assert.equal(readHistory(DIR, "acc.md").length, 2, "빈 범위는 남기지 않는다");
});

test("수락을 되무르면 구간은 결정 전으로 정확히 돌아간다", () => {
  record(DIR, "undo.md", "", "hello world\n", me);
  record(DIR, "undo.md", "hello world\n", "goodbye world\n", pi);
  const before = replay(readHistory(DIR, "undo.md")).spans;
  assert.equal(before[0].removed, "hello", "되돌리면 hello가 된다");

  decide(DIR, "undo.md", before[0].from, before[0].to, 10, true);
  assert.equal(replay(readHistory(DIR, "undo.md")).spans[0].accepted, true);

  decide(DIR, "undo.md", before[0].from, before[0].to, 11, false);
  assert.deepEqual(replay(readHistory(DIR, "undo.md")).spans, before, "구간이 통째였으니 뺀 글까지 그대로다");
});

test("폭 없는 결정은 그 자리에 삭제가 있을 때만 남는다", () => {
  record(DIR, "gap.md", "", "one two three", me);
  decide(DIR, "gap.md", 4, 4, 20, true);
  assert.equal(readHistory(DIR, "gap.md").length, 1, "지운 것이 없는 자리의 결정은 줄이 되지 않는다");
  record(DIR, "gap.md", "one two three", "one three", pi);
  const at = replay(readHistory(DIR, "gap.md")).removals[0].pos;
  decide(DIR, "gap.md", at, at, 21, true);
  assert.equal(readHistory(DIR, "gap.md").length, 3);
  assert.equal(replay(readHistory(DIR, "gap.md")).removals[0].accepted, true);
});

test("결정은 지워지지 않고 반대 줄로 무른다 — 로그는 늘기만 한다", () => {
  record(DIR, "ledger.md", "", "one two three", pi);
  const at = { from: 4, to: 7 };
  decide(DIR, "ledger.md", at.from, at.to, 12, true);
  decide(DIR, "ledger.md", at.from, at.to, 13, false);
  const log = readHistory(DIR, "ledger.md");
  assert.deepEqual(log.slice(-2).map((c) => c.kept), [true, false]);
  assert.equal(replay(log).spans.some((s) => s.accepted), false, "마지막 말이 이긴다");
});

test("kept가 없는 옛 줄은 수락으로 읽는다", () => {
  record(DIR, "old.md", "", "one two three", pi);
  // A log written before a decision could be taken back.
  appendHistory(DIR, "old.md", [{ author: "me", at: 14, from: 4, to: 7, inserted: "two", removed: "two" }]);
  assert.equal(replay(readHistory(DIR, "old.md")).spans.some((s) => s.accepted), true);
});

test("같은 노트에 같은 것을 다시 기록해도 로그는 늘지 않는다", () => {
  record(DIR, "idem.md", "", "x\n", me);
  const before = readHistory(DIR, "idem.md").length;
  assert.deepEqual(record(DIR, "idem.md", "x\n", "x\n", pi), []);
  assert.equal(readHistory(DIR, "idem.md").length, before);
});

test("로그는 노트를 따라 옮겨지고, 없는 로그는 옮길 것이 없다", () => {
  record(DIR, "mv/a.md", "", "text\n", me);
  moveHistory(DIR, "mv/a.md", "mv/deep/b.md");
  assert.deepEqual(readHistory(DIR, "mv/a.md"), []);
  assert.equal(replay(readHistory(DIR, "mv/deep/b.md")).text, "text\n");
  assert.equal(existsSync(historyPath(DIR, "mv/a.md")), false);
  moveHistory(DIR, "mv/never.md", "mv/x.md");
  assert.equal(existsSync(historyPath(DIR, "mv/x.md")), false);
});

test("기록한 변경은 로그의 맨 뒤에 온다 — 먼저 정산한 것이 있어도", () => {
  record(DIR, "tail.md", "", "mine\n", me);
  // Someone wrote outside the app; the next record settles that first.
  writeFileSync(join(DIR, "tail.md"), "mine, theirs\n");
  const changes = record(DIR, "tail.md", "mine, theirs\n", "mine, theirs, pi's\n", pi);
  const log = readHistory(DIR, "tail.md");
  assert.deepEqual(log.slice(log.length - changes.length), changes, "마지막 n줄이 방금 쓴 그 n개다");
  assert.equal(log.at(-1 - changes.length).author, "outside", "정산한 줄은 그 앞에 있다");
  // Which is what lets a caller say where the log stood just before this write.
  assert.equal(replay(log.slice(0, log.length - changes.length)).text, "mine, theirs\n");
});

// --- before: the note with pi's undecided changes put back ---

import { unreviewed } from "../history.ts";

/** What a diff would be against: `before` plus pi's undecided changes is the text. */
const beforeOf = (log) => unreviewed(log).before;

test("pi가 아무것도 안 했으면 before는 지금 글이다", () => {
  const log = [...changesBetween("", "mine\n", me), ...changesBetween("mine\n", "mine, more\n", me)];
  assert.equal(beforeOf(log), "mine, more\n");
  assert.deepEqual(unreviewed(log).holes, []);
});

test("pi가 바꾼 것은 before에서 원래대로다 — 넣은 것, 바꾼 것, 지운 것 모두", () => {
  const base = changesBetween("", "one two three\n", me);
  assert.equal(beforeOf([...base, ...changesBetween("one two three\n", "one two three four\n", pi)]), "one two three\n", "넣은 것");
  assert.equal(beforeOf([...base, ...changesBetween("one two three\n", "one TWO three\n", pi)]), "one two three\n", "바꾼 것");
  assert.equal(beforeOf([...base, ...changesBetween("one two three\n", "one three\n", pi)]), "one two three\n", "지운 것");
});

test("수락하면 before에 들어가고, 무르면 다시 빠진다", () => {
  const log = [...changesBetween("", "one two three\n", me), ...changesBetween("one two three\n", "one TWO three\n", pi)];
  const [hole] = unreviewed(log).holes;
  const kept = [...log, { ...me, at: 9, from: hole.from, to: hole.to, inserted: "TWO", removed: "TWO", kept: true }];
  assert.equal(beforeOf(kept), "one TWO three\n");
  assert.deepEqual(unreviewed(kept).holes, []);
  const back = [...kept, { ...me, at: 10, from: hole.from, to: hole.to, inserted: "TWO", removed: "TWO", kept: false }];
  assert.equal(beforeOf(back), "one two three\n");
});

test("지운 것은 폭 없는 결정으로 수락된다", () => {
  const log = [...changesBetween("", "one two three\n", me), ...changesBetween("one two three\n", "one three\n", pi)];
  const [hole] = unreviewed(log).holes;
  assert.equal(hole.from, hole.to, "폭이 없다");
  assert.equal(hole.removed, "two ");
  const kept = [...log, { ...me, at: 9, from: hole.from, to: hole.from, inserted: "", removed: "", kept: true }];
  assert.equal(beforeOf(kept), "one three\n");
});

test("pi가 같은 곳을 두 번 고치면 구멍은 하나고, before는 맨 처음 것이다", () => {
  const log = [
    ...changesBetween("", "one two three\n", me),
    ...changesBetween("one two three\n", "one TWO three\n", pi),
    ...changesBetween("one TWO three\n", "one TWO! three\n", { ...pi, at: 3 }),
  ];
  assert.equal(unreviewed(log).holes.length, 1);
  assert.equal(beforeOf(log), "one two three\n");
});

test("사람이 pi의 미결정 글 안에서 고친 것은 그 덩어리의 것이다", () => {
  const log = [
    ...changesBetween("", "one two three\n", me),
    ...changesBetween("one two three\n", "one TWO three\n", pi),
    ...changesBetween("one TWO three\n", "one TwO three\n", { ...me, at: 3 }),
  ];
  assert.equal(beforeOf(log), "one two three\n", "사람의 w도 pi의 덩어리 안에 있다");
  const { text, holes } = unreviewed(log);
  assert.equal(text.slice(holes[0].from, holes[0].to), "TwO");
});

test("pi 단어 끝에 사람이 이어 붙인 것은 사람의 것이다 — 되돌려도 남아야 하니", () => {
  const log = [
    ...changesBetween("", "one two three\n", me),
    ...changesBetween("one two three\n", "one TWO three\n", pi),
    ...changesBetween("one TWO three\n", "one TWO? three\n", { ...me, at: 3 }),
  ];
  assert.equal(beforeOf(log), "one two? three\n", "?는 before에도 있다");
  const { text, holes } = unreviewed(log);
  assert.equal(text.slice(holes[0].from, holes[0].to), "TWO");
});

test("사람이 pi의 미결정 글 밖에서 고친 것은 before에도 있다", () => {
  const log = [
    ...changesBetween("", "one two three\n", me),
    ...changesBetween("one two three\n", "one TWO three\n", pi),
    ...changesBetween("one TWO three\n", "ZERO one TWO three\n", { ...me, at: 3 }),
    ...changesBetween("ZERO one TWO three\n", "ZERO one TWO three four\n", { ...me, at: 4 }),
  ];
  assert.equal(beforeOf(log), "ZERO one two three four\n");
  const { text, holes } = unreviewed(log);
  assert.equal(text.slice(holes[0].from, holes[0].to), "TWO", "구멍은 앞의 편집만큼 밀렸다");
});

test("pi의 글 바로 뒤에 이어 쓴 것은 pi의 것이 아니다", () => {
  const log = [...changesBetween("", "one ", me), ...changesBetween("one ", "one two", pi), ...changesBetween("one two", "one two three", { ...me, at: 3 })];
  assert.equal(beforeOf(log), "one  three", "before에는 pi의 two만 없다 — 두 공백 사이에 있던 것");
  assert.equal(unreviewed(log).text.slice(unreviewed(log).holes[0].from, unreviewed(log).holes[0].to), "two");
});

test("before는 로그가 아무리 길어도 지금 글과 홀만으로 다시 만들 수 있다", () => {
  const steps = ["", "abc", "abXc", "aXc", "aXcYZ", "YZ", "Q", "Q!", "Q!!"];
  const log = [];
  for (let i = 1; i < steps.length; i++) log.push(...changesBetween(steps[i - 1], steps[i], i % 2 ? me : pi));
  const { text, before, holes } = unreviewed(log);
  assert.equal(text, "Q!!");
  let rebuilt = text;
  for (const h of [...holes].reverse()) rebuilt = rebuilt.slice(0, h.from) + h.removed + rebuilt.slice(h.to);
  assert.equal(rebuilt, before);
  let last = 0;
  for (const h of holes) {
    assert.ok(h.from >= last && h.to >= h.from, "홀은 겹치지 않고 순서대로다");
    last = h.to;
  }
});
