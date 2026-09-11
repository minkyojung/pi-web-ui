import assert from "node:assert/strict";
import test from "node:test";

import { bump, forget } from "../web/src/recent.ts";

test("연 노트가 맨 앞으로 오고, 다시 열면 다시 맨 앞이며, 길이는 잘린다", () => {
  assert.deepEqual(bump([], "a.md"), ["a.md"]);
  assert.deepEqual(bump(["a.md"], "b.md"), ["b.md", "a.md"]);
  assert.deepEqual(bump(["b.md", "a.md"], "a.md"), ["a.md", "b.md"]);
  assert.deepEqual(bump(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
});

test("이름이 바뀌면 그 자리에 새 이름이, 지워지면 빠진다", () => {
  assert.deepEqual(forget(["a.md", "b.md", "c.md"], "b.md", "B.md"), ["a.md", "B.md", "c.md"]);
  assert.deepEqual(forget(["a.md", "b.md"], "b.md"), ["a.md"]);
  assert.deepEqual(forget(["a.md"], "zzz.md", "y.md"), ["a.md"], "없던 것은 넣지 않는다");
  assert.deepEqual(forget(["a.md", "b.md"], "a.md", "b.md"), ["b.md"], "새 이름이 이미 있으면 하나로");
});
