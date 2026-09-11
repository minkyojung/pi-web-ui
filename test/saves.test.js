import assert from "node:assert/strict";
import test from "node:test";

import { flushSaves, registerSave } from "../web/src/saves.ts";

test("등록된 저장이 그 뒤의 전송보다 먼저 불린다", () => {
  const order = [];
  const off = registerSave(() => order.push("save"));
  flushSaves();
  order.push("prompt");
  assert.deepEqual(order, ["save", "prompt"]);
  off();
});

test("편집기가 없으면 아무 일도 없고, 물러난 편집기의 저장은 불리지 않는다", () => {
  flushSaves();
  const calls = [];
  const off = registerSave(() => calls.push("old"));
  off();
  flushSaves();
  assert.deepEqual(calls, []);
});

test("두 번째 등록이 첫 번째를 대신하고, 첫 번째의 해제는 두 번째를 건드리지 않는다", () => {
  const calls = [];
  const offA = registerSave(() => calls.push("a"));
  const offB = registerSave(() => calls.push("b"));
  offA();
  flushSaves();
  assert.deepEqual(calls, ["b"]);
  offB();
});
