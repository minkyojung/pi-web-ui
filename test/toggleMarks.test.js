import assert from "node:assert/strict";
import test from "node:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { toggleMark } from "../web/src/features/toggleMarks.ts";

/** The doc after toggling `mark` with the selection at `sel`, and where the selection ends up. */
const after = (doc, sel, mark = "**") => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(sel.map(([a, h]) => EditorSelection.range(a, h ?? a))),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  const next = state.update(toggleMark(state, mark)).state;
  return { doc: next.doc.toString(), sel: next.selection.ranges.map((r) => [r.from, r.to]) };
};

test("고른 글을 감싸고, 고른 것은 그 글에 남는다", () => {
  assert.deepEqual(after("say hi now", [[4, 6]]), { doc: "say **hi** now", sel: [[6, 8]] });
});

test("이미 감싸인 글이면 벗긴다, 마크를 같이 골랐든 아니든", () => {
  assert.deepEqual(after("say **hi** now", [[6, 8]]), { doc: "say hi now", sel: [[4, 6]] });
  assert.deepEqual(after("say **hi** now", [[4, 10]]), { doc: "say hi now", sel: [[4, 6]] });
});

test("커서만 있으면 빈 쌍을 넣고 그 사이에 두며, 다시 누르면 뺀다", () => {
  assert.deepEqual(after("say ", [[4]]), { doc: "say ****", sel: [[6, 6]] });
  assert.deepEqual(after("say ****", [[6]]), { doc: "say ", sel: [[4, 4]] });
});

test("기울임은 별 하나, 굵게 안에서도 제 것만 본다", () => {
  assert.deepEqual(after("**hi**", [[2, 4]], "*"), { doc: "***hi***", sel: [[3, 5]] });
  assert.deepEqual(after("***hi***", [[3, 5]], "*"), { doc: "**hi**", sel: [[2, 4]] });
});

test("커서가 여럿이면 한 번에, 한 걸음으로", () => {
  assert.deepEqual(after("a b", [[0, 1], [2, 3]]), { doc: "**a** **b**", sel: [[2, 3], [8, 9]] });
});
