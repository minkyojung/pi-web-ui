import assert from "node:assert/strict";
import test from "node:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { fitted, leaving } from "../web/src/features/viewPlace.ts";

/** Enough of a view for `leaving`: a state with a selection and a scrolled box. */
const view = (doc, anchor, head, scrollTop) => ({
  state: EditorState.create({ doc, selection: EditorSelection.range(anchor, head) }),
  scrollDOM: { scrollTop },
});

test("떠나는 자리는 커서와 스크롤이다", () => {
  assert.deepEqual(leaving(view("hello world", 6, 11, 120)), { anchor: 6, head: 11, scrollTop: 120 });
});

test("페이지가 있으면 스크롤은 그 페이지의 것이다", () => {
  assert.deepEqual(leaving(view("hello world", 0, 0, 120), { scrollTop: 640 }), { anchor: 0, head: 0, scrollTop: 640 });
});

test("글이 짧아졌으면 그 끝까지만", () => {
  const left = { anchor: 6, head: 11, scrollTop: 0 };
  assert.deepEqual(fitted(left, 11), { anchor: 6, head: 11 });
  assert.deepEqual(fitted(left, 8), { anchor: 6, head: 8 });
  assert.deepEqual(fitted(left, 2), { anchor: 2, head: 2 });
});
