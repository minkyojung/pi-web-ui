import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { blockAt, indentWidth, itemAt, linesOf, markerOf, parentOf } from "../web/src/features/listTree.ts";

const parsed = (doc) => {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  assert.ok(ensureSyntaxTree(s, s.doc.length, 5000), "parsed whole");
  return s;
};

test("마커를 한 번에 푼다: 글자, 할 일 표시, 뒤 공백, 글 시작", () => {
  const s = parsed("- a\n1. b\n- [x] c\n-\n");
  const at = (pos) => { const m = markerOf(s, itemAt(s, pos)); return [m.text, m.task ? s.doc.sliceString(m.task.from, m.task.to) : null, m.spaced, m.prefixEnd - m.line.from, m.contentStart - m.line.from]; };
  assert.deepEqual(at(0), ["-", null, true, 2, 2]);
  assert.deepEqual(at(4), ["1.", null, true, 3, 3]);
  assert.deepEqual(at(9), ["-", "[x]", true, 2, 6]);
  assert.deepEqual(at(17), ["-", null, false, 1, 1], "a bare - : no space, the item's content would start right after it");
});

test("줄의 앞 공백, 노드의 줄들, 항목의 부모와 블록", () => {
  const s = parsed("- a\n    - b\n      more\n- c\n");
  assert.equal(indentWidth(s.doc.line(2)), 4);
  assert.equal(indentWidth(s.doc.line(1)), 0);
  const b = itemAt(s, 8);
  assert.deepEqual(linesOf(s, b).map((l) => l.number), [2, 3]);
  assert.equal(s.doc.lineAt(parentOf(b).from).number, 1);
  assert.equal(parentOf(itemAt(s, 0)), null);
  assert.equal(blockAt(s, 8).name, "BulletList");
  assert.equal(blockAt(s, 8).from, 0);
});
