import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";

import { hidden } from "../web/src/features/livePreview.ts";
import { wikiLink } from "../wikilink.ts";

const state = (doc, cursor = doc.length) =>
	EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage, extensions: [wikiLink] })] });

/** What `hidden` hides, as the text of each range. */
const gone = (s) => {
  const out = [];
  const it = hidden(s, 0, s.doc.length).iter();
  for (; it.value; it.next()) out.push(s.doc.sliceString(it.from, it.to));
  return out;
};

test("커서가 없는 헤딩은 #과 그 뒤 공백을 숨긴다", () => {
  assert.deepEqual(gone(state("## Hi\n\ntext")), ["## "]);
});

test("커서가 닿은 헤딩은 그대로 보인다", () => {
  assert.deepEqual(gone(state("## Hi\n\ntext", 3)), []);
  assert.deepEqual(gone(state("## Hi\n\ntext", 0)), [], "at the start counts as touching");
  assert.deepEqual(gone(state("## Hi\n\ntext", 5)), [], "at the end too");
});

test("강조는 별표를 숨기고 글은 남긴다", () => {
  assert.deepEqual(gone(state("*a* and **b**\n")), ["*", "*", "**", "**"]);
});

test("커서가 강조 안에 있으면 그 강조만 드러난다", () => {
  assert.deepEqual(gone(state("*a* and **b**\n", 2)), ["**", "**"]);
});

test("선택 영역이 걸친 노드는 모두 드러난다", () => {
  const s = EditorState.create({
    doc: "*a* and **b**\n",
    selection: EditorSelection.range(1, 10),
    extensions: [markdown({ base: markdownLanguage, extensions: [wikiLink] })],
  });
  assert.deepEqual(gone(s), []);
});

test("마크다운 링크는 글만 남긴다", () => {
  assert.deepEqual(gone(state("[text](http://x.y)\n")), ["[", "]", "(", "http://x.y", ")"]);
});

test("위키링크는 괄호를 숨기고, 별칭이 있으면 대상도 숨긴다", () => {
  assert.deepEqual(gone(state("[[note]] [[note|shown]]\n")), ["[[", "]]", "[[", "note", "|", "]]"]);
});

test("범위 밖은 보지 않는다", () => {
  const s = state("# a\n\n# b\n");
  const it = hidden(s, 0, 3).iter();
  const out = [];
  for (; it.value; it.next()) out.push(it.from);
  assert.deepEqual(out, [0]);
});
