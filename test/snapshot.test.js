/**
 * 옆에 적어둔 답을 언제 믿고 언제 버리는가.
 *
 * 틀린 스냅샷은 느린 것보다 나쁘다 — 앱은 이 답을 디스크와 견주어 그 차이를 누군가의
 * 편집으로 적으므로, 이 장부의 것이 아닌 답은 없는 편집을 만들어내고 거기에 이름까지 붙인다.
 * 그래서 조금이라도 어긋나면 고치지 않고 버린다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { forgetSnapshot, hashOf, readSnapshot, snapshotPath, writeSnapshot } from "../snapshot.ts";

const state = { text: "hello", spans: [{ author: "me", at: 1, from: 0, to: 5 }], holes: [] };
const dir = () => mkdtempSync(join(tmpdir(), "snapshot-"));
const logWith = (root, lines) => {
  const file = join(root, "a.md.jsonl");
  writeFileSync(file, lines.map((l) => `${l}\n`).join(""));
  return file;
};

test("적어둔 답은 그 장부의 것일 때만 돌아온다", () => {
  const root = dir();
  try {
    const log = logWith(root, ["one", "two", "three"]);
    writeSnapshot(log, ["one", "two", "three"], state);
    assert.equal(snapshotPath(log), join(root, "a.md.snapshot.json"), "장부 옆, 장부는 그대로");
    const back = readSnapshot(log, ["one", "two", "three"]);
    assert.equal(back.lines, 3);
    assert.equal(back.text, "hello");
    assert.deepEqual(back.spans, state.spans);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("장부가 이어 쓰이면 앞부분이 그대로인 한 여전히 이 장부의 것이다", () => {
  const root = dir();
  try {
    const log = logWith(root, ["one", "two"]);
    writeSnapshot(log, ["one", "two"], state);
    appendFileSync(log, "three\n");
    const back = readSnapshot(log, ["one", "two", "three"]);
    assert.equal(back?.lines, 2, "두 줄까지의 답이고, 세 번째 줄은 이어 걸으면 된다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("앞부분이 한 글자라도 다르면 버린다", () => {
  const root = dir();
  try {
    const log = logWith(root, ["one", "two", "three"]);
    writeSnapshot(log, ["one", "two", "three"], state);
    assert.equal(readSnapshot(log, ["one", "TWO", "three"]), null, "다른 장부의 답");
    assert.equal(readSnapshot(log, ["one"]), null, "장부가 답보다 짧다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("읽을 수 없는 것은 고치지 않고 버린다", () => {
  const root = dir();
  try {
    const log = logWith(root, ["one"]);
    mkdirSync(join(root, "x"), { recursive: true });
    writeFileSync(snapshotPath(log), "{ 반쪽만 쓰다 만");
    assert.equal(readSnapshot(log, ["one"]), null);
    writeFileSync(snapshotPath(log), JSON.stringify({ lines: 1, hash: hashOf("one") }), "utf8");
    assert.equal(readSnapshot(log, ["one"]), null, "모양이 모자란 것도 마찬가지");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("장부가 움직이면 답은 따라가지 않고 없어진다", () => {
  const root = dir();
  try {
    const log = logWith(root, ["one"]);
    writeSnapshot(log, ["one"], state);
    assert.equal(existsSync(snapshotPath(log)), true);
    forgetSnapshot(log);
    assert.equal(existsSync(snapshotPath(log)), false);
    assert.doesNotThrow(() => forgetSnapshot(log), "없는 것을 지우는 것은 아무 일도 아니다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("답 파일은 통째로 갈아 끼워진다 — 반쪽이 남지 않게", () => {
  const root = dir();
  try {
    const log = logWith(root, ["one"]);
    writeSnapshot(log, ["one"], { ...state, text: "the longer answer that was here before" });
    writeSnapshot(log, ["one"], state);
    assert.equal(JSON.parse(readFileSync(snapshotPath(log), "utf8")).text, "hello");
    assert.deepEqual(
      readFileSync(snapshotPath(log), "utf8").includes("longer answer"),
      false,
      "앞 답의 꼬리가 남지 않는다",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- 장부와 함께 ---

import { appendHistory, changesBetween, historyPath, historyOf, replay } from "../history.ts";

/** 사람이 한 줄씩 써 내려간 장부 하나. */
const wrote = (root, path, texts) => {
  let before = "";
  for (const [i, after] of texts.entries()) {
    appendHistory(root, path, changesBetween(before, after, { author: "me", at: 1000 + i }));
    before = after;
  }
  return before;
};
const linesOf = (root, path) => readFileSync(historyPath(root, path), "utf8").split("\n").filter(Boolean);

test("걸음이 느렸으면 답을 남긴다 — 그리고 다음엔 그 뒤만 걷는다", () => {
  const root = dir();
  try {
    const text = wrote(root, "a.md", ["one ", "one two ", "one two three "]);
    // 0ms를 넘는 걸음은 없다시피 하므로, 남기는 쪽을 확실히 하려고 문턱을 0으로 준다.
    const first = historyOf(root, "a.md", 0);
    assert.equal(first.replayed.text, text);
    const snap = JSON.parse(readFileSync(snapshotPath(historyPath(root, "a.md")), "utf8"));
    assert.equal(snap.lines, linesOf(root, "a.md").length, "장부 전체까지의 답");
    assert.equal(snap.text, text);

    // 그 위에 한 줄 더. 답은 그대로 맞아야 한다.
    appendHistory(root, "a.md", changesBetween(text, `${text}four `, { author: "pi", at: 2000, sessionId: "s", entryId: "e" }));
    const again = historyOf(root, "a.md");
    assert.equal(again.replayed.text, `${text}four `);
    assert.equal(again.replayed.spans.at(-1).author, "pi", "이어 걸어도 저자는 그대로");
    assert.equal(again.holed.holes.length, 1, "pi가 쓴 것은 결정할 것으로 남는다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("앞부분은 다시 걷지 않는다 — 답이 그렇다고 말한다", () => {
  const root = dir();
  try {
    wrote(root, "a.md", ["one ", "one two ", "one two three "]);
    const lines = linesOf(root, "a.md");
    const file = historyPath(root, "a.md");
    // 앞 두 줄까지의 답이라며, 진짜와 다른 글을 적어둔다. 앞 두 줄을 정말로 건너뛰는지는
    // 이 글이 답에 남아 있는지로 알 수 있다 — 다시 걸었다면 흔적도 없을 것이다.
    writeSnapshot(file, lines.slice(0, 2), { text: "PRETEND ", spans: [], holes: [] });
    const { replayed } = historyOf(root, "a.md");
    const changes = lines.map((l) => JSON.parse(l));
    assert.deepEqual(replayed, replay(changes.slice(2), { text: "PRETEND ", spans: [] }));
    assert.match(replayed.text, /^PRETEND /, "앞 두 줄은 읽히지 않았다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("장부의 앞부분이 달라졌으면 답을 버리고 처음부터 걷는다", () => {
  const root = dir();
  try {
    const text = wrote(root, "a.md", ["one ", "one two ", "one two three "]);
    const file = historyPath(root, "a.md");
    const lines = linesOf(root, "a.md");
    writeSnapshot(file, lines.slice(0, 2), { text: "PRETEND ", spans: [], holes: [] });
    // 앞 줄이 손대어졌다: 해시가 어긋나므로 답은 이 장부의 것이 아니다.
    const tampered = [...lines];
    tampered[0] = JSON.stringify({ ...JSON.parse(lines[0]), inserted: "ONE " });
    writeFileSync(file, tampered.map((l) => `${l}\n`).join(""));
    const { replayed } = historyOf(root, "a.md");
    assert.equal(replayed.text, text.replace("one ", "ONE "), "장부가 말하는 그대로");
    assert.equal(replayed.text.includes("PRETEND"), false, "옆에 있던 답은 쓰이지 않았다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
