import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { apply, appendHistory, changesBetween, decide, historyPath, mapThrough, moveHistory, readHistory, reclaimLog, reconcile, record, replay, trashLog, trashHistoryPath, wroteIn, fromEdits } from "../history.ts";

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

// --- the editor's own account of what it did ---

test("편집기가 말한 대로 적힌다 — 나란한 좌표가 차례 좌표가 되고, 글자 하나면 글자 하나다", () => {
  const before = "one two three";
  // Two edits side by side in `before`: a letter inside "one", and "three" replaced.
  const edits = [{ from: 1, to: 2, insert: "N" }, { from: 8, to: 13, insert: "3" }];
  const after = "oNe two 3";
  const changes = fromEdits(before, edits, after, me);
  assert.deepEqual(changes, [
    { ...me, from: 1, to: 2, inserted: "N", removed: "n" },
    { ...me, from: 8, to: 13, inserted: "3", removed: "three" },
  ]);
  const { spans, text } = replay([...changesBetween("", before, pi), ...changes]);
  assert.equal(text, after);
  assert.deepEqual(spans.map((s) => [s.author, text.slice(s.from, s.to)]), [["pi", "o"], ["me", "N"], ["pi", "e two "], ["me", "3"]], "고친 글자만 내 것 — 단어 통째가 아니다");
});

test("앞의 편집이 뒤의 자리를 옮긴다", () => {
  const before = "ab";
  const changes = fromEdits(before, [{ from: 0, to: 0, insert: "XXX" }, { from: 1, to: 2, insert: "" }], "XXXa", me);
  assert.deepEqual(changes.map((c) => [c.from, c.to, c.inserted]), [[0, 0, "XXX"], [4, 5, ""]]);
});

test("아무것도 안 바꾼 편집은 줄이 되지 않는다 — 줄이 되면 결정으로 읽히므로", () => {
  assert.deepEqual(fromEdits("abc", [{ from: 1, to: 2, insert: "b" }], "abc", me), []);
});

test("말이 맞지 않으면 믿지 않는다 — 결과가 다르거나, 자리가 겹치거나, 글 밖이거나", () => {
  assert.equal(fromEdits("abc", [{ from: 0, to: 1, insert: "X" }], "abc", me), null, "결과가 다르다");
  assert.equal(fromEdits("abc", [{ from: 0, to: 2, insert: "X" }, { from: 1, to: 3, insert: "Y" }], "XY", me), null, "겹친다");
  assert.equal(fromEdits("abc", [{ from: 2, to: 3, insert: "X" }, { from: 0, to: 1, insert: "Y" }], "YbX", me), null, "순서가 거꾸로다");
  assert.equal(fromEdits("abc", [{ from: 0, to: 9, insert: "X" }], "X", me), null, "글 밖이다");
  assert.equal(fromEdits("abc", [{ from: 0, to: 1, insert: 5 }], "5bc", me), null, "모양이 아니다");
});

test("record는 편집기의 말이 맞으면 그대로, 아니면 두 글을 읽어 적는다", () => {
  record(DIR, "said.md", "", "one two\n", me);
  record(DIR, "said.md", "one two\n", "oNe two\n", { ...me, at: 3 }, [{ from: 1, to: 2, insert: "N" }]);
  assert.deepEqual(readHistory(DIR, "said.md").at(-1), { ...me, at: 3, from: 1, to: 2, inserted: "N", removed: "n" }, "글자 하나");
  record(DIR, "said.md", "oNe two\n", "oNe TWO\n", { ...me, at: 4 }, [{ from: 0, to: 0, insert: "nonsense" }]);
  assert.deepEqual(readHistory(DIR, "said.md").at(-1), { ...me, at: 4, from: 4, to: 7, inserted: "TWO", removed: "two" }, "맞지 않으니 단어 단위로 읽었다");
});

test("한 런에 pi가 이 노트에 썼는지는 세션과 시각으로 안다 — 사람의 글도, 결정도 아니다", () => {
  const log = [
    ...changesBetween("", "mine\n", { author: "me", at: 10 }),
    ...changesBetween("mine\n", "mine and pi's\n", { author: "pi", at: 20, sessionId: "s1", entryId: "e" }),
    { author: "me", at: 25, from: 5, to: 13, inserted: "and pi's", removed: "and pi's", kept: true },
  ];
  assert.equal(wroteIn(log, "s1", 15, 30), true);
  assert.equal(wroteIn(log, "s1", 21, 30), false, "그 시간 밖");
  assert.equal(wroteIn(log, "s2", 15, 30), false, "다른 세션");
  assert.equal(wroteIn(log, "s1", 24, 26), false, "결정은 쓴 것이 아니다");
  assert.equal(wroteIn(log, "s1", 5, 12), false, "사람이 쓴 것은 pi의 런이 아니다");
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

test("지운 노트의 로그는 비켜난다 — 같은 이름의 새 노트가 남의 과거를 물려받지 않도록", () => {
  const dir = mkdtempSync(join(tmpdir(), "history-trash-"));
  try {
    appendHistory(dir, "a.md", changesBetween("", "one", me));
    trashLog(dir, "a.md");
    assert.deepEqual(readHistory(dir, "a.md"), [], "노트 자리에는 로그가 없다");
    assert.ok(existsSync(trashHistoryPath(dir, "a.md")), "휴지통에서 기다린다");
    // 같은 이름을 두 번 지우면 뒤엣것은 시각이 붙은 이름으로 기다린다 — 앞엣것을 덮지 않는다.
    appendHistory(dir, "a.md", changesBetween("", "another note that took the name", me));
    trashLog(dir, "a.md");
    const waiting = readdirSync(join(dir, ".pi/trash/history"));
    assert.equal(waiting.length, 2, `둘 다 남는다: ${waiting.join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("휴지통에서 돌아온 노트는 제 과거를 되찾는다 — 재생이 디스크와 정확히 같을 때만", () => {
  const dir = mkdtempSync(join(tmpdir(), "history-back-"));
  try {
    // 사람이 쓰고, pi가 한 마디 보태고, 지운다.
    reconcile(dir, "a.md", "one\n", 1, me);
    record(dir, "a.md", "one\n", "one two\n", pi);
    trashLog(dir, "a.md");

    // 파인더의 Put Back: 같은 바이트가 돌아온다.
    reconcile(dir, "a.md", "one two\n", 5);
    const changes = readHistory(dir, "a.md");
    assert.equal(replay(changes).text, "one two\n");
    assert.equal(changes.at(-1).author, "pi", "pi가 쓴 말은 돌아와서도 pi의 것이다");
    assert.equal(changes.filter((c) => c.author === "outside").length, 0, "바깥에서 온 것으로 새로 씨 뿌리지 않는다");
    assert.equal(existsSync(trashHistoryPath(dir, "a.md")), false, "휴지통에서 도로 나왔다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("같은 이름의 다른 노트에게는 그 과거가 가지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "history-other-"));
  try {
    reconcile(dir, "a.md", "one\n", 1, me);
    trashLog(dir, "a.md");
    // 이름만 같은 새 노트.
    reconcile(dir, "a.md", "something else entirely\n", 5);
    const changes = readHistory(dir, "a.md");
    assert.equal(changes.length, 1, "제 과거는 비어 있고, 지금 글이 처음 본 것으로 들어간다");
    assert.equal(changes[0].author, "before");
    assert.ok(existsSync(trashHistoryPath(dir, "a.md")), "앞 노트의 과거는 휴지통에 그대로 있다");
    assert.equal(reclaimLog(dir, "b.md", "one\n"), null, "다른 이름으로는 찾지 않는다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

test("처음 보는 노트는 통째로 앱 이전의 글로 심어진다 — 아무도 쓰는 것을 보지 못했으니", () => {
  const { spans } = reconcile(DIR, "seed.md", "already here\n", 5);
  assert.deepEqual(spans, [{ author: "before", at: 5, from: 0, to: 13, removed: "" }]);
  assert.equal(existsSync(historyPath(DIR, "seed.md")), true);
});

test("앱 이전이라는 말이 없던 때의 로그는 첫 줄의 바깥을 앱 이전으로 읽는다 — 로그는 고치지 않는다", () => {
  // Written as the app wrote it then: no `v` on a line.
  const raw = [
    { author: "outside", at: 1, from: 0, to: 0, inserted: "old words\n", removed: "" },
    { author: "outside", at: 2, from: 0, to: 0, inserted: "vim: ", removed: "" },
  ].map((c) => JSON.stringify(c)).join("\n") + "\n";
  mkdirSync(join(DIR, ".pi/history"), { recursive: true });
  writeFileSync(historyPath(DIR, "old-seed.md"), raw);
  assert.deepEqual(readHistory(DIR, "old-seed.md").map((c) => c.author), ["before", "outside"], "첫 줄만, 씨앗인 줄만");
  assert.equal(readFileSync(historyPath(DIR, "old-seed.md"), "utf8"), raw, "파일은 그대로다");
  const { spans } = reconcile(DIR, "old-seed.md", "vim: old words\n", 3);
  assert.deepEqual(spans.map((s) => s.author), ["outside", "before"]);
});

test("지금 적는 줄은 제 모양을 말하고, 폴더에 나타난 노트의 바깥 씨앗은 바깥으로 읽힌다", () => {
  reconcile(DIR, "fresh.md", "appeared\n", 1, { author: "outside", at: 1 });
  assert.ok(readFileSync(historyPath(DIR, "fresh.md"), "utf8").startsWith('{"v":1,'), "줄마다 v");
  assert.deepEqual(readHistory(DIR, "fresh.md").map((c) => c.author), ["outside"]);
  assert.equal("v" in readHistory(DIR, "fresh.md")[0], false, "v는 줄의 것이지 변경의 것이 아니다");
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
  assert.deepEqual(spans.map((s) => s.author), ["pi"], "이름을 준 쪽의 말이 그대로 적힌다");
});

test("따라잡을 것이 없으면 아무것도 붙지 않는다", () => {
  reconcile(DIR, "twice.md", "once\n", 13, pi);
  const before = readHistory(DIR, "twice.md").length;
  const { appended } = reconcile(DIR, "twice.md", "once\n", 14, pi);
  assert.deepEqual(appended, []);
  assert.equal(readHistory(DIR, "twice.md").length, before, "이미 따라잡은 것을 다시 적지 않는다");
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

/** 그 노트에서 지금 결정을 기다리는 자리. 화면의 청크가 가리키는 것과 같은 범위다. */
const unreviewedAt = (dir, path) => unreviewed(readHistory(dir, path)).holes[0];

test("accept는 지금 글 위의 범위를 빈 교체로 남긴다", () => {
  record(DIR, "acc.md", "", "pi wrote this\n", pi);
  const hole = unreviewedAt(DIR, "acc.md");
  assert.equal(decide(DIR, "acc.md", hole.from, hole.to, 7, true), true);
  assert.deepEqual(unreviewed(readHistory(DIR, "acc.md")).holes, [], "결정하고 나면 결정할 것이 없다");
  assert.deepEqual(replay(readHistory(DIR, "acc.md")).spans.map((s) => s.author), ["pi"], "누가 썼는지는 그대로다");
  assert.equal(decide(DIR, "acc.md", 5, 5, 8, true), false);
  assert.equal(readHistory(DIR, "acc.md").length, 2, "빈 범위는 남기지 않는다");
});

test("결정할 것을 통째로 담지 못하는 자리는 기록되지 않는다", () => {
  record(DIR, "off.md", "", "pi wrote this\n", pi);
  const hole = unreviewedAt(DIR, "off.md");
  const lines = () => readHistory(DIR, "off.md").length;
  const was = lines();
  // 탭이 한 글자 앞서 있을 때 보내는 것이 정확히 이 모양이다: 같은 청크, 전부 한 칸씩.
  assert.equal(decide(DIR, "off.md", hole.from + 1, hole.to + 1, 30, true), false, "앞으로 밀림");
  assert.equal(decide(DIR, "off.md", hole.from - 1, hole.to - 1, 31, true), false, "뒤로 밀림");
  assert.equal(decide(DIR, "off.md", hole.from + 2, hole.to - 2, 32, true), false, "일부만");
  assert.equal(decide(DIR, "off.md", 0, 0, 33, true), false, "아무것도 없는 자리");
  assert.equal(lines(), was, "거절된 결정은 장부에 줄을 남기지 않는다");
  assert.equal(unreviewed(readHistory(DIR, "off.md")).holes.length, 1, "엉뚱한 자리를 결정된 것으로 치지도 않는다");
  // 청크는 홀보다 넓을 수 있다 — 담고 있으면 그것은 결정이다.
  assert.equal(decide(DIR, "off.md", hole.from, hole.to + 1, 34, true), true, "더 넓은 것은 담고 있으므로 결정이다");
});

test("수락을 되무르면 결정 전으로 정확히 돌아간다", () => {
  record(DIR, "undo.md", "", "hello world\n", me);
  record(DIR, "undo.md", "hello world\n", "goodbye world\n", pi);
  const spans = replay(readHistory(DIR, "undo.md")).spans;
  assert.equal(spans[0].removed, "hello", "되돌리면 hello가 된다");
  const before = unreviewed(readHistory(DIR, "undo.md"));
  assert.equal(before.holes.length, 1);

  decide(DIR, "undo.md", before.holes[0].from, before.holes[0].to, 10, true);
  assert.deepEqual(unreviewed(readHistory(DIR, "undo.md")).holes, []);

  decide(DIR, "undo.md", before.holes[0].from, before.holes[0].to, 11, false);
  assert.deepEqual(unreviewed(readHistory(DIR, "undo.md")), before, "결정할 것도, 되돌릴 글도 그대로다");
  assert.deepEqual(replay(readHistory(DIR, "undo.md")).spans, spans, "결정은 구간을 건드리지 않는다");
});

test("폭 없는 결정은 그 자리에 삭제가 있을 때만 남는다", () => {
  record(DIR, "gap.md", "", "one two three", me);
  decide(DIR, "gap.md", 4, 4, 20, true);
  assert.equal(readHistory(DIR, "gap.md").length, 1, "지운 것이 없는 자리의 결정은 줄이 되지 않는다");
  record(DIR, "gap.md", "one two three", "one three", pi);
  const seam = unreviewedAt(DIR, "gap.md");
  assert.equal(seam.from, seam.to, "지우기만 한 자리는 폭이 없다");
  decide(DIR, "gap.md", seam.from, seam.to, 21, true);
  assert.equal(readHistory(DIR, "gap.md").length, 3);
  assert.deepEqual(unreviewed(readHistory(DIR, "gap.md")).holes, []);
});

test("결정은 지워지지 않고 반대 줄로 무른다 — 로그는 늘기만 한다", () => {
  record(DIR, "ledger.md", "", "one two three", pi);
  const at = unreviewedAt(DIR, "ledger.md");
  decide(DIR, "ledger.md", at.from, at.to, 12, true);
  decide(DIR, "ledger.md", at.from, at.to, 13, false);
  const log = readHistory(DIR, "ledger.md");
  assert.deepEqual(log.slice(-2).map((c) => c.kept), [true, false]);
  assert.equal(unreviewed(log).holes.length, 1, "마지막 말이 이긴다");
});

test("kept가 없는 옛 줄은 수락으로 읽는다", () => {
  record(DIR, "old.md", "", "one two three", pi);
  // A log written before a decision could be taken back.
  appendHistory(DIR, "old.md", [{ author: "me", at: 14, from: 0, to: 13, inserted: "one two three", removed: "one two three" }]);
  assert.deepEqual(unreviewed(readHistory(DIR, "old.md")).holes, []);
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

test("사람이 pi의 글을 손으로 원래대로 돌려놓으면 결정할 것이 없다", () => {
  const log = [
    ...changesBetween("", "one two three\n", me),
    ...changesBetween("one two three\n", "one TWO three\n", pi),
    ...changesBetween("one TWO three\n", "one two three\n", { ...me, at: 3 }),
  ];
  const { text, before, holes } = unreviewed(log);
  assert.equal(before, text, "다른 것이 없다");
  assert.deepEqual(holes, [], "그러니 내놓을 구멍도 없다");
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
