import assert from "node:assert/strict";
import test from "node:test";

import { back, canBack, canForward, empty, forget, forward, go, here, remember, replace, restored } from "../web/src/nav.ts";

/** 걸음에서 id를 뺀 것: id는 이 창 안에서만 뜻이 있어 견주지 않는다. */
const step = ({ id, ...rest }) => rest;

/** 경로만 늘어놓아 보기 위한 것: 서 있는 자리는 ▸로 표시한다. */
const shown = (nav) => nav.entries.map((e, i) => (i === nav.at ? `▸${e.path}` : e.path));

const opened = (...paths) => paths.reduce((nav, path) => go(nav, path), empty);

test("연 노트는 끝에 쌓이고, 보고 있는 것을 또 열면 아무 일도 없다", () => {
  const nav = opened("a", "b", "c");
  assert.deepEqual(shown(nav), ["a", "b", "▸c"]);
  assert.equal(go(nav, "c"), nav, "제자리는 참조까지 그대로다");
  assert.deepEqual(step(here(nav)), { path: "c" });
  assert.equal(here(empty), null);
});

test("뒤로 가도 항목은 남고, 앞으로 되돌아온다", () => {
  const nav = back(back(opened("a", "b", "c")));
  assert.deepEqual(shown(nav), ["▸a", "b", "c"]);
  assert.deepEqual(shown(forward(nav)), ["a", "▸b", "c"]);
  assert.deepEqual(shown(forward(forward(nav))), ["a", "b", "▸c"]);
});

test("뒤로 간 뒤에 새로 열면 앞길이 잘린다", () => {
  const nav = go(back(back(opened("a", "b", "c"))), "d");
  assert.deepEqual(shown(nav), ["a", "▸d"]);
  assert.equal(canForward(nav), false, "b와 c로 가는 길은 없어졌다");
});

test("갈 곳이 없으면 그대로다", () => {
  assert.equal(canBack(empty), false);
  assert.equal(canForward(empty), false);
  assert.equal(back(empty), empty);
  assert.equal(forward(empty), empty);
  const one = go(empty, "a");
  assert.equal(canBack(one), false, "처음 연 노트 앞에는 아무것도 없다");
  assert.equal(back(one), one);
  assert.equal(forward(one), one);
});

test("같은 노트라도 다른 자리로 뛰면 다른 걸음이다", () => {
  const place = { heading: "둘째 장", block: null };
  const nav = go(go(empty, "a"), "a", place);
  assert.deepEqual(shown(nav), ["a", "▸a"]);
  assert.deepEqual(step(here(nav)), { path: "a", place: { heading: "둘째 장", block: null } });
  assert.equal(go(nav, "a", { ...place, alias: null }), nav, "자리가 같으면 링크가 달라도 제자리다");
  assert.deepEqual(shown(back(nav)), ["▸a", "a"]);
});

test("링크가 가리키는 곳이 없으면 자리도 남기지 않는다", () => {
  assert.deepEqual(step(here(go(empty, "a", { heading: null, block: null }))), { path: "a" });
  assert.deepEqual(step(here(go(empty, "a", null))), { path: "a" });
});

test("멀리 가면 가장 오래된 것부터 버려진다", () => {
  const many = Array.from({ length: 60 }, (_, i) => `n${i}`);
  const nav = opened(...many);
  assert.equal(nav.entries.length, 50);
  assert.deepEqual(shown(nav).slice(0, 1), ["n10"]);
  assert.deepEqual(step(here(nav)), { path: "n59" });
  assert.equal(nav.at, 49);
});

test("탭을 닫아 옆 노트가 앞에 와도 걸음이 늘지는 않는다", () => {
  const nav = replace(opened("a", "b", "c"), "b");
  assert.deepEqual(shown(nav), ["a", "▸b"], "c가 있던 자리는 그것을 열기 전 걸음에 접힌다");
  assert.deepEqual(shown(back(nav)), ["▸a", "b"], "뒤로가기가 헛걸음이 되지 않는다");
  assert.equal(replace(nav, "b"), nav, "이미 그것이면 그대로다");
  assert.deepEqual(shown(replace(empty, "a")), ["▸a"], "빈 목록에서는 여는 것과 같다");
  assert.deepEqual(shown(replace(back(opened("a", "b", "c")), "c")), ["a", "▸c"], "앞으로 갈 곳이 앞에 오면 그리로 접힌다");
  assert.deepEqual(shown(replace(back(opened("a", "b", "c")), "d")), ["a", "▸d", "c"], "겹치지 않으면 자리만 갈아끼운다");
});

test("이름이 바뀌면 걸음도 따라가고, 지워지면 걸음에서 빠진다", () => {
  const nav = opened("a", "b", "c");
  assert.deepEqual(shown(forget(nav, "b", "B")), ["a", "B", "▸c"]);
  assert.deepEqual(shown(forget(nav, "c")), ["a", "▸b"], "서 있던 것이 지워지면 그 앞으로 물러선다");
  assert.deepEqual(shown(forget(nav, "a")), ["b", "▸c"], "서 있지 않던 것이 지워져도 서 있는 곳은 그대로다");
  assert.deepEqual(shown(forget(back(back(nav)), "a")), ["▸b", "c"], "서 있던 것이 지워지고 그 앞에 아무것도 없으면 첫 걸음으로");
  assert.deepEqual(shown(forget(opened("a"), "a")), [], "하나뿐이었으면 아무것도 남지 않는다");
  assert.equal(forget(empty, "a").at, -1);
});

test("지워진 노트를 사이에 두고 같은 노트가 붙으면 한 걸음이 된다", () => {
  const nav = opened("a", "b", "a", "c");
  assert.deepEqual(shown(forget(nav, "b")), ["a", "▸c"]);
  assert.deepEqual(shown(forget(back(back(nav)), "b")), ["▸a", "c"], "접힌 두 걸음 위에 서 있었다면 남은 하나 위에 선다");
  assert.deepEqual(shown(forget(opened("a", "b", "c"), "c", "a")), ["a", "b", "▸a"], "이름이 바뀌어 옆과 같아진 것도 마찬가지다");
});

test("걸음은 이 브라우저에 남고, 돌아올 때 서 있던 자리만 링크가 가리키던 곳을 잊는다", () => {
  const place = { heading: "둘째 장", block: null };
  const nav = go(go(go(empty, "a", place), "b"), "c", place);
  const again = restored(JSON.parse(JSON.stringify(nav)));
  assert.deepEqual(shown(again), ["a", "b", "▸c"]);
  assert.deepEqual(again.entries[0].place, place, "지나온 걸음의 자리는 남는다 — 되돌아가는 것은 그 링크를 다시 따라가는 것이므로");
  assert.equal(again.entries[2].place, undefined, "다시 열리는 노트는 커서를 옮기지 않는다");
});

test("남은 것이 이 목록이 아니면 없던 것으로 한다", () => {
  assert.deepEqual(restored(null), empty);
  assert.deepEqual(restored("[]"), empty);
  assert.deepEqual(restored({ entries: [], at: 0 }), empty);
  assert.deepEqual(restored({ entries: [{ path: "a" }], at: "1" }), empty);
  assert.deepEqual(restored({ entries: [{ path: "a" }, { no: "path" }], at: 0 }), empty);
  assert.deepEqual(shown(restored({ entries: [{ path: "a" }, { path: "b" }], at: 9 })), ["a", "▸b"], "자리가 목록 밖이면 마지막 걸음에 선다");
  assert.deepEqual(step(restored({ entries: [{ path: "a" }, { path: "b", place: { heading: 7 } }], at: 0 }).entries[1]), { path: "b" }, "자리라 할 수 없는 것은 자리가 아니다");
});

/** 한 걸음을 떠나며 남긴 자리. */
const at = (nav, scrollTop) => remember(nav, here(nav).id, { anchor: 0, head: 0, scrollTop });

test("자리는 노트가 아니라 걸음이 가진다: 같은 노트의 두 걸음은 서로 다른 곳에 선다", () => {
  // a를 맨 위에서 읽다 b로, a를 다시 열어 아래에서 읽다 c로.
  let nav = go(empty, "a");
  nav = go(at(nav, 0), "b");
  nav = go(nav, "a");
  nav = go(at(nav, 600), "c");
  assert.equal(here(back(nav)).left.scrollTop, 600, "한 걸음 뒤는 아래에서 읽던 a");
  assert.equal(here(back(back(back(nav)))).left.scrollTop, 0, "세 걸음 뒤는 맨 위에서 읽던 그 a");
});

test("다시 여는 노트는 마지막으로 읽던 자리를 물려받고, 그것이 걸음의 자리가 된다", () => {
  let nav = go(empty, "a");
  nav = go(at(nav, 600), "b");
  nav = go(nav, "a");
  assert.equal(here(nav).left.scrollTop, 600, "새 걸음이지만 마지막으로 읽던 곳에서 열린다");
  assert.equal(here(back(back(nav))).left.scrollTop, 600, "물려준 걸음은 그대로다");
  assert.equal(here(go(empty, "never")).left, undefined, "읽은 적 없으면 물려받을 것도 없다");
});

test("목록에 없는 걸음의 자리는 아무 데도 적히지 않는다", () => {
  const nav = go(empty, "a");
  assert.equal(remember(nav, 9999, { anchor: 1, head: 1, scrollTop: 1 }), nav);
});

test("걸음의 자리는 창이 닫혀도 남고, 자리라 할 수 없는 것은 버려진다", () => {
  const nav = at(go(go(empty, "a"), "b"), 600);
  const again = restored(JSON.parse(JSON.stringify(nav)));
  assert.equal(here(again).left.scrollTop, 600, "다시 열면 읽던 곳에서 열린다");
  assert.equal(restored({ entries: [{ path: "a", left: { anchor: 0, head: 0 } }], at: 0 }).entries[0].left, undefined);
  assert.equal(restored({ entries: [{ path: "a", left: { anchor: -1, head: 0, scrollTop: 0 } }], at: 0 }).entries[0].left, undefined);
});
