import assert from "node:assert/strict";
import test from "node:test";

import { EditorState } from "@codemirror/state";

import { chips, commits, taskCommit } from "../web/src/features/taskCommit.ts";

const PLAN = "# Plan\n\n- [x] 1. Add the door\n- [x] 2. Hang the sign\n- [x] 2.1 Cut the board\n- [ ] 2.2 Paint it\n";
const known = new Map([
  ["1", { commit: "e87ccbf0000", short: "e87ccbf" }],
  ["2.1", { commit: "6038d5d0000", short: "6038d5d" }],
  ["2.2", { commit: "aaaaaaa0000", short: "aaaaaaa" }],
]);
const state = (doc, map = known) => EditorState.create({ doc, extensions: [taskCommit, commits.of(map)] });
const drawn = (s) => {
  const out = [];
  const it = s.field(chips).iter();
  for (; it.value; it.next()) out.push([s.doc.lineAt(it.from).number, it.from === s.doc.lineAt(it.from).to, it.value.spec.widget.task, it.value.spec.widget.short]);
  return out;
};

test("칩은 끝났고 커밋이 있는 잎 작업의 줄 끝에 선다", () => {
  assert.deepEqual(drawn(state(PLAN)), [
    [3, true, "1", "e87ccbf"],
    [5, true, "2.1", "6038d5d"],
  ], "묶음 2에는 제 커밋이 없고, 2.2는 커밋이 알려져 있어도 칸이 안 체크됐다");
});

test("손으로 체크한 칸에는 지어낼 것이 없다 — 커밋을 모르면 칩도 없다", () => {
  assert.deepEqual(drawn(state(PLAN, new Map([["2.1", known.get("2.1")]]))), [[5, true, "2.1", "6038d5d"]]);
  assert.deepEqual(drawn(state(PLAN, new Map())), []);
});

test("문서와 알려진 커밋을 따라간다", () => {
  const s = state(PLAN);
  const at = PLAN.indexOf("[ ] 2.2");
  const done = s.update({ changes: { from: at, to: at + 3, insert: "[x]" } }).state;
  assert.deepEqual(drawn(done).map(([, , task]) => task), ["1", "2.1", "2.2"], "칸이 체크되면 생긴다");
});
