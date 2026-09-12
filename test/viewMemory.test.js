import assert from "node:assert/strict";
import test from "node:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { comeBack, leave, remembered } from "../web/src/features/viewMemory.ts";

/** Enough of a view for `leave`: a state with a selection and a scrolled box. */
const view = (doc, anchor, head, scrollTop) => ({
  state: EditorState.create({ doc, selection: EditorSelection.range(anchor, head) }),
  scrollDOM: { scrollTop },
});

test("떠난 자리를 기억하고, 돌아올 때 그 자리를 준다", () => {
  leave("a.md", view("hello world", 6, 11, 120));
  assert.deepEqual(remembered("a.md"), { anchor: 6, head: 11, scrollTop: 120 });
  assert.deepEqual(comeBack("a.md", 11), { anchor: 6, head: 11 });
});

test("글이 짧아졌으면 그 끝까지만", () => {
  leave("b.md", view("hello world", 6, 11, 0));
  assert.deepEqual(comeBack("b.md", 8), { anchor: 6, head: 8 });
  assert.deepEqual(comeBack("b.md", 2), { anchor: 2, head: 2 });
});

test("떠난 적 없는 노트는 없음", () => {
  assert.equal(comeBack("never.md", 10), null);
});

test("다시 떠나면 마지막 자리가 남는다", () => {
  leave("c.md", view("abc", 1, 1, 0));
  leave("c.md", view("abc", 3, 3, 50));
  assert.deepEqual(remembered("c.md"), { anchor: 3, head: 3, scrollTop: 50 });
});
