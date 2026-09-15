import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { blockAt, indentWidth, itemAt, linesOf, markerOf, parentOf } from "../web/src/features/listTree.ts";

const parsed = (doc) => {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  assert.ok(ensureSyntaxTree(s, s.doc.length, 5000), "parsed whole");
  // And into the state, which an empty transaction is what takes it: a state holds the tree it was
  // made with — 3,000 characters, 20ms — and ensureSyntaxTree hands its own back without replacing
  // that one, so a helper reading the state's tree would read the partial one. See listTree.ts.
  return s.update({}).state;
};

test("긴 노트에서도 상태 자신의 트리가 온전하다: 처음 파싱은 3,000자에서 멈추므로", () => {
  // Deterministic, not a matter of load: EditorState.create parses an opening viewport of 3,000
  // characters, and what it could not finish it takes as a partial tree. A helper called without
  // a tree reads that one, and past its end there are no list items at all.
  const s = parsed("- a\n".repeat(2000));
  assert.equal(syntaxTree(s).length, s.doc.length, "the state's own tree, not only the one ensureSyntaxTree hands back");
  assert.ok(itemAt(s, s.doc.length - 2), "the last item, found without a tree passed in");
});

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
