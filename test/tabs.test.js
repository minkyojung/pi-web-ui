import assert from "node:assert/strict";
import test from "node:test";

import { add, close, move, neighbour, others, reopen, toTheRight } from "../web/src/tabs.ts";

test("연 노트는 줄 끝에 붙고, 이미 있으면 그대로다", () => {
  assert.deepEqual(add([], "a.md"), ["a.md"]);
  assert.deepEqual(add(["a.md"], "b.md"), ["a.md", "b.md"]);
  const same = ["a.md", "b.md"];
  assert.equal(add(same, "a.md"), same, "순서도 참조도 바뀌지 않는다");
});

test("앞에 있는 탭을 닫으면 오른쪽 이웃이, 없으면 왼쪽이, 그것도 없으면 아무것도 앞에 오지 않는다", () => {
  assert.deepEqual(close(["a", "b", "c"], "b", "b"), { tabs: ["a", "c"], active: "c" });
  assert.deepEqual(close(["a", "b", "c"], "c", "c"), { tabs: ["a", "b"], active: "b" });
  assert.deepEqual(close(["a"], "a", "a"), { tabs: [], active: null });
});

test("다른 탭을 닫으면 앞에 있는 것은 그대로다", () => {
  assert.deepEqual(close(["a", "b", "c"], "a", "b"), { tabs: ["b", "c"], active: "b" });
  const tabs = ["a", "b"];
  assert.deepEqual(close(tabs, "zzz", "a"), { tabs, active: "a" }, "없는 것을 닫으면 아무 일도 없다");
});

test("닫은 탭은 있던 자리로 돌아오고, 줄이 짧아졌으면 끝에, 이미 열려 있으면 그대로다", () => {
  assert.deepEqual(reopen(["a", "c"], { path: "b", at: 1 }), ["a", "b", "c"]);
  assert.deepEqual(reopen(["a"], { path: "c", at: 2 }), ["a", "c"]);
  const tabs = ["a", "b"];
  assert.equal(reopen(tabs, { path: "a", at: 0 }), tabs);
});

test("이웃은 끝에서 처음으로 돌고, 앞에 있는 것이 없으면 첫 탭이며, 탭이 없으면 없다", () => {
  assert.equal(neighbour(["a", "b", "c"], "b", 1), "c");
  assert.equal(neighbour(["a", "b", "c"], "c", 1), "a");
  assert.equal(neighbour(["a", "b", "c"], "a", -1), "c");
  assert.equal(neighbour(["a", "b"], null, 1), "a");
  assert.equal(neighbour(["a", "b"], "zzz", -1), "a");
  assert.equal(neighbour([], null, 1), null);
});

test("옮기면 나머지가 메우고, 같은 자리나 없는 자리는 그대로다", () => {
  assert.deepEqual(move(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(move(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  const tabs = ["a", "b"];
  assert.equal(move(tabs, 1, 1), tabs);
  assert.equal(move(tabs, 0, 5), tabs);
});

test("다른 탭은 그것만 빼고 전부, 오른쪽은 그 뒤의 것들, 없는 탭의 오른쪽은 없다", () => {
  assert.deepEqual(others(["a", "b", "c"], "b"), ["a", "c"]);
  assert.deepEqual(toTheRight(["a", "b", "c"], "a"), ["b", "c"]);
  assert.deepEqual(toTheRight(["a", "b", "c"], "c"), []);
  assert.deepEqual(toTheRight(["a", "b"], "zzz"), []);
});
