import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { listLines } from "../web/src/features/listIndent.ts";

const parsed = (doc) => {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(s, s.doc.length, 1000);
  return s;
};
/** Each decoration as [line, style] for a line, or [prefix text] for the marker's box. */
const drawn = (s, from = 0, to = s.doc.length) => {
  const out = [];
  const it = listLines(s, from, to).iter();
  for (; it.value; it.next()) {
    if (it.value.spec.class?.startsWith("cm-list-line")) out.push([s.doc.lineAt(it.from).number, it.value.spec.attributes.style + (it.value.spec.class.includes("marker") ? " marker" : "")]);
    else out.push([s.doc.sliceString(it.from, it.to)]);
  }
  return out;
};

test("항목 줄은 단계만큼의 들여쓰기를 받고 마커 줄로 표시되며, 마커는 상자에 들어간다", () => {
  assert.deepEqual(drawn(parsed("- a\n- b\n")), [
    [1, "--list-indent:1.5em marker"], ["- "],
    [2, "--list-indent:1.5em marker"], ["- "],
  ]);
});

test("안긴 항목은 한 단계 더 밀리고, 들여쓴 공백은 마커의 상자에 든다", () => {
  assert.deepEqual(drawn(parsed("- a\n  - b\n")), [
    [1, "--list-indent:1.5em marker"], ["- "],
    [2, "--list-indent:3em marker"], ["  - "],
  ]);
});

test("마커가 없는 이어지는 줄은 밀리기만 한다", () => {
  assert.deepEqual(drawn(parsed("- a\n  more\n")), [
    [1, "--list-indent:1.5em marker"], ["- "],
    [2, "--list-indent:1.5em"],
  ]);
});

test("번호와 인용 속 항목도 같다", () => {
  assert.deepEqual(drawn(parsed("10. x\n\n> - q\n")), [
    [1, "--list-indent:1.5em marker"], ["10. "],
    [3, "--list-indent:1.5em marker"], ["> - "],
  ]);
});

test("리스트가 아닌 줄과 범위 밖은 손대지 않는다", () => {
  assert.deepEqual(drawn(parsed("text\n\n- a\n")), [[3, "--list-indent:1.5em marker"], ["- "]]);
  assert.deepEqual(drawn(parsed("- a\n- b\n"), 0, 3), [[1, "--list-indent:1.5em marker"], ["- "]]);
});
