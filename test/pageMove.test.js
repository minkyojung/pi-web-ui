import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";

import { noteSyntax } from "../syntax.ts";
import { properties } from "../web/src/features/properties.ts";
import { atTextTop, nextPart, textStart } from "../web/src/features/pageMove.ts";

const state = (doc, cursor = 0) =>
  EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage, extensions: [noteSyntax] }), properties] });

test("페이지의 순서: 제목, 속성, 글", () => {
  const all = () => true;
  assert.equal(nextPart("title", 1, all), "properties");
  assert.equal(nextPart("properties", 1, all), "text");
  assert.equal(nextPart("text", 1, all), null);
  assert.equal(nextPart("text", -1, all), "properties");
  assert.equal(nextPart("properties", -1, all), "title");
  assert.equal(nextPart("title", -1, all), null);
});

test("없는 자리는 건너뛴다 — 속성이 없으면 제목과 글이 이웃이다", () => {
  const noProperties = (part) => part !== "properties";
  assert.equal(nextPart("title", 1, noProperties), "text");
  assert.equal(nextPart("text", -1, noProperties), "title");
  assert.equal(nextPart("text", -1, () => false), null, "갈 곳이 없으면 아무 데도 가지 않는다");
});

test("글이 시작하는 자리는 블록 아래, 블록이 없으면 맨 위", () => {
  assert.equal(textStart(state("---\na: 1\n---\n# hi\n")), 13);
  assert.equal(textStart(state("# hi\n")), 0);
  // 닫히지 않은 블록은 프론트매터가 아니다(frontmatter.ts) — 글은 맨 위에서 시작한다.
  assert.equal(textStart(state("---\na: 1\n# hi\n")), 0);
});

test("글의 맨 위는 블록 바로 아래 한 자리다", () => {
  const s = state("---\na: 1\n---\n# hi\nmore\n");
  assert.equal(atTextTop(s, 13), true);
  assert.equal(atTextTop(s, 12), true, "위로 넘어가 버린 자리도 맨 위다");
  assert.equal(atTextTop(s, 14), false);
  assert.equal(atTextTop(state("# hi\n"), 0), true);
});
