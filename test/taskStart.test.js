import assert from "node:assert/strict";
import test from "node:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { blocked, running, starts, taskStart } from "../web/src/features/taskStart.ts";

const PLAN = "# Plan\n\n- [ ] 1. Add the door\n- [ ] 2. Hang the sign\n- [x] 2.1 Cut the board\n- [ ] 2.2 Paint it\n";
const state = (doc, { cursor = 0, why = null, now = null } = {}) =>
  EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [taskStart, blocked.of(why), running.of(now)] });

/** The Starts drawn, as [line number, task number, here, why]. */
const drawn = (s) => {
  const out = [];
  const it = s.field(starts).iter();
  for (; it.value; it.next()) {
    const widget = it.value.spec.widget;
    if (widget) out.push([s.doc.lineAt(it.from).number, widget.number, widget.here, widget.why]);
  }
  return out;
};

test("Start는 할 것이 남은 작업의 줄 앞에 선다 — 묶음도(남은 하위 전부의 것), 끝난 것에는 없다", () => {
  assert.deepEqual(drawn(state(PLAN)), [
    [3, "1", false, null],
    [4, "2", false, null],
    [6, "2.2", false, null],
  ]);
  const it = state(PLAN).field(starts).iter();
  const widgets = [];
  for (; it.value; it.next()) if (it.value.spec.widget) widgets.push(it.value.spec.widget);
  assert.deepEqual(widgets.map((w) => w.under), [[], ["2.2"], []], "묶음의 Start는 무엇을 돌릴지 안다");
});

test("커서가 있는 줄의 Start는 그렇다고 표시된다 — 포인터 없이 보이는 하나", () => {
  const at = PLAN.indexOf("Paint it");
  assert.deepEqual(drawn(state(PLAN, { cursor: at })).map(([line, , here]) => [line, here]), [[3, false], [4, false], [6, true]]);
  const moved = state(PLAN, { cursor: at }).update({ selection: EditorSelection.cursor(PLAN.indexOf("door")) }).state;
  assert.deepEqual(drawn(moved).map(([line, , here]) => [line, here]), [[3, true], [4, false], [6, false]], "커서를 옮기면 따라온다");
});

test("막힌 이유는 위젯이 들고, 바뀌면 다시 그려진다", () => {
  const busy = state(PLAN, { why: "The agent is working" });
  assert.deepEqual(drawn(busy).map(([, number, , why]) => [number, why]), [["1", "The agent is working"], ["2", "The agent is working"], ["2.2", "The agent is working"]]);
});

test("칸이 체크되면 그 줄의 Start가 사라진다 — 문서를 따라간다", () => {
  const s = state(PLAN);
  const done = s.update({ changes: { from: PLAN.indexOf("[ ] 1."), to: PLAN.indexOf("[ ] 1.") + 3, insert: "[x]" } }).state;
  assert.deepEqual(drawn(done).map(([, number]) => number), ["2", "2.2"]);
  const text = done.doc.toString();
  const all = done.update({ changes: { from: text.indexOf("[ ] 2.2"), to: text.indexOf("[ ] 2.2") + 3, insert: "[x]" } }).state;
  assert.deepEqual(drawn(all).map(([, number]) => number), [], "하위가 다 끝나면 묶음의 것도 간다");
});

test("선택이 덮은 작업의 Start는 켜진다 — 막대가 돌릴 것과 같은 규칙으로", () => {
  const from = PLAN.indexOf("door");
  const to = PLAN.indexOf("- [ ] 2.2");
  const s = state(PLAN).update({ selection: EditorSelection.range(from, to) }).state;
  assert.deepEqual(drawn(s).map(([, number, here]) => [number, here]), [["1", true], ["2", true], ["2.2", false]], "2.2의 0열에서 끝나면 2.2는 안 든다; 2는 덮였다");
  const more = s.update({ selection: EditorSelection.range(from, to + 1) }).state;
  assert.deepEqual(drawn(more).map(([, number, here]) => [number, here]), [["1", true], ["2", true], ["2.2", false]], "2.2는 2 안으로 접힌다 — 켜지는 것은 돌릴 것과 같다");
});

test("도는 작업의 Start는 돈다 — 그 줄과, 그것을 품은 묶음의 줄", () => {
  const s = state(PLAN, { why: "The agent is working", now: "2.2" });
  const it = s.field(starts).iter();
  const turning = [];
  for (; it.value; it.next()) if (it.value.spec.widget) turning.push([it.value.spec.widget.number, it.value.spec.widget.turning]);
  assert.deepEqual(turning, [["1", false], ["2", true], ["2.2", true]], "2.2가 돌면 2도 그것으로 돈다");
});
