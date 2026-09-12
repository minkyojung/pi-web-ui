import assert from "node:assert/strict";
import test from "node:test";

import { parser as markdown } from "@lezer/markdown";

import { highlight } from "../highlight.ts";
import { wikiLink } from "../wikilink.ts";

const parser = markdown.configure([wikiLink, highlight]);
/** The inline nodes of `text` under its first paragraph, as [name, text]. */
const inline = (text) => {
  const out = [];
  parser.parse(text).iterate({
    enter: (n) => {
      if (n.name === "Document" || n.name === "Paragraph") return;
      out.push([n.name, text.slice(n.from, n.to)]);
    },
  });
  return out;
};

test("==글==은 강조 노드 하나와 양끝의 표시다", () => {
  assert.deepEqual(inline("a ==hi== b"), [["Highlight", "==hi=="], ["HighlightMark", "=="], ["HighlightMark", "=="]]);
});

test("안쪽 공백이 있으면 열리지 않는다, ~~처럼", () => {
  assert.deepEqual(inline("a == hi == b"), []);
});

test("=이 셋이면 첫 것은 글자고 나머지 둘이 표시다, lezer의 ~~와 같이", () => {
  assert.deepEqual(inline("a ===hi=== b"), [["Highlight", "==hi==="], ["HighlightMark", "=="], ["HighlightMark", "=="]]);
});

test("강조 안의 링크는 여전히 링크다", () => {
  assert.deepEqual(inline("==see [[note]]==").map(([n]) => n), ["Highlight", "HighlightMark", "WikiLink", "WikiLinkMark", "WikiLinkTarget", "WikiLinkMark", "HighlightMark"]);
});

test("코드 안에서는 글자일 뿐이다", () => {
  assert.deepEqual(inline("`==x==`").map(([n]) => n), ["InlineCode", "CodeMark", "CodeMark"]);
});

test("닫히지 않으면 글자다", () => {
  assert.deepEqual(inline("a ==hi b"), []);
});
