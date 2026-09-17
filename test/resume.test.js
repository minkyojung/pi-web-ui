/**
 * 이어 걷기는 처음부터 걷기와 같다 — 어디서 끊어도.
 *
 * 스냅샷이 서는 전제가 이것 하나다. 장부의 앞부분을 걸어 상태를 얻어두고 나중에 뒷부분만
 * 이어 걸었을 때, 처음부터 끝까지 걸은 것과 **글자 하나까지 같아야** 한다. 다르면
 * 저작 기록이 틀리고, 틀린 저작 기록은 되돌릴 수 없다.
 *
 * 그래서 예시 몇 개가 아니라 성질로 묻는다: 씨앗을 바꿔가며 장부를 만들어내고, 그 안의
 * 모든 지점에서 끊어본다. 만들어내는 장부는 앱이 실제로 쓰는 것과 같은 방법으로 만든다 —
 * `changesBetween`이 낸 변경과, 사람이 내리는 결정(isTouch) 줄.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { changesBetween, holesOf, replay } from "../history.ts";

/** 씨앗을 주면 늘 같은 수열. 테스트가 어느 날만 빨개지는 일이 없도록. */
const random = (seed) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const WORDS = ["alpha", "beta", "감마", "delta", "엡실론", "zeta", "eta"];
const AUTHORS = ["me", "pi", "outside", "pi"];

/** 글 하나를 조금 고친 글. 넣거나, 지우거나, 갈아 끼우거나. */
function mutate(text, next) {
  const word = WORDS[Math.floor(next() * WORDS.length)];
  const at = Math.floor(next() * (text.length + 1));
  const roll = next();
  if (roll < 0.5 || text.length < 6) return text.slice(0, at) + word + " " + text.slice(at);
  const to = Math.min(text.length, at + 1 + Math.floor(next() * 10));
  if (roll < 0.75) return text.slice(0, at) + text.slice(to);
  return text.slice(0, at) + word + text.slice(to);
}

/** 앱이 쌓는 것과 같은 모양의 장부 하나. */
function madeUpLog(seed, steps = 60) {
  const next = random(seed);
  const changes = [];
  let text = "";
  for (let i = 0; i < steps; i++) {
    // 가끔은 글이 아니라 결정이 적힌다: 글자는 그대로고 "봤다"만 남는 줄.
    if (next() < 0.2 && text.length > 4) {
      const from = Math.floor(next() * text.length);
      const to = Math.min(text.length, from + 1 + Math.floor(next() * 8));
      const words = text.slice(from, to);
      changes.push({ author: "me", at: 1000 + i, from, to, inserted: words, removed: words, kept: next() < 0.7 });
      continue;
    }
    const author = AUTHORS[Math.floor(next() * AUTHORS.length)];
    const origin = { author, at: 1000 + i, ...(author === "pi" ? { sessionId: "s", entryId: `e${i}` } : {}) };
    const after = mutate(text, next);
    changes.push(...changesBetween(text, after, origin));
    text = after;
  }
  return changes;
}

test("replay: 어느 지점에서 끊어 이어 걸어도 처음부터 걸은 것과 같다", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const changes = madeUpLog(seed);
    const whole = replay(changes);
    for (let k = 0; k <= changes.length; k++) {
      const resumed = replay(changes.slice(k), replay(changes.slice(0, k)));
      assert.deepEqual(resumed, whole, `씨앗 ${seed}, ${k}번째 줄에서 끊었을 때`);
    }
  }
});

test("holesOf: 어느 지점에서 끊어 이어 걸어도 처음부터 걸은 것과 같다", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const changes = madeUpLog(seed);
    const whole = holesOf(changes);
    for (let k = 0; k <= changes.length; k++) {
      const resumed = holesOf(changes.slice(k), holesOf(changes.slice(0, k)));
      assert.deepEqual(resumed, whole, `씨앗 ${seed}, ${k}번째 줄에서 끊었을 때`);
    }
  }
});

test("건네받은 상태를 고쳐 쓰지 않는다 — 한 번 읽은 스냅샷으로 여러 번 이어 걷는다", () => {
  const changes = madeUpLog(7);
  const half = Math.floor(changes.length / 2);
  const state = replay(changes.slice(0, half));
  const copy = structuredClone(state);
  const once = replay(changes.slice(half), state);
  assert.deepEqual(state, copy, "이어 걷고 나서도 처음 상태 그대로");
  const twice = replay(changes.slice(half), state);
  assert.deepEqual(twice, once, "같은 상태에서 두 번 이어 걸어도 같은 답");

  const holed = holesOf(changes.slice(0, half));
  const holedCopy = structuredClone(holed);
  holesOf(changes.slice(half), holed);
  assert.deepEqual(holed, holedCopy);
});
