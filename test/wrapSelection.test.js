import assert from "node:assert/strict";
import test from "node:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { wrapped } from "../web/src/features/wrapSelection.ts";

const after = (doc, sel, typed) => {
  const state = EditorState.create({ doc, selection: EditorSelection.create(sel.map(([a, h]) => EditorSelection.range(a, h ?? a))), extensions: EditorState.allowMultipleSelections.of(true) });
  const tr = wrapped(state, typed);
  if (!tr) return null;
  const next = state.update(tr).state;
  return { doc: next.doc.toString(), sel: next.selection.ranges.map((r) => [r.from, r.to]) };
};

test("고른 글 위에 *를 치면 감싸고, 고른 것은 그 글에 남는다; 한 번 더 치면 굵게", () => {
  assert.deepEqual(after("say hi now", [[4, 6]], "*"), { doc: "say *hi* now", sel: [[5, 7]] });
  assert.deepEqual(after("say *hi* now", [[5, 7]], "*"), { doc: "say **hi** now", sel: [[6, 8]] });
});

test("=, ~, %는 둘씩 감싼다", () => {
  assert.deepEqual(after("say hi now", [[4, 6]], "="), { doc: "say ==hi== now", sel: [[6, 8]] });
  assert.deepEqual(after("say hi now", [[4, 6]], "~"), { doc: "say ~~hi~~ now", sel: [[6, 8]] });
  assert.deepEqual(after("say hi now", [[4, 6]], "%"), { doc: "say %%hi%% now", sel: [[6, 8]] });
});

test("고른 것이 없으면 아무것도 하지 않아, 줄 머리의 *는 여전히 리스트를 연다", () => {
  assert.equal(after("say hi now", [[4]], "*"), null);
});

test("표시가 아닌 글자는 그대로 둔다", () => {
  assert.equal(after("say hi now", [[4, 6]], "a"), null);
});

test("커서가 여럿이면 고른 것들만 감싸고, 빈 커서는 그대로다", () => {
  assert.deepEqual(after("a b c", [[0, 1], [2], [4, 5]], "_"), { doc: "_a_ b _c_", sel: [[1, 2], [4, 4], [7, 8]] });
});
