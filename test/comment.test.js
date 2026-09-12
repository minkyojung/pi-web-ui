import assert from "node:assert/strict";
import test from "node:test";

import { linksIn } from "../links.ts";
import { parser } from "../syntax.ts";

/** The nodes of `text` under its first paragraph, as [name, text]. */
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

test("%%글%%은 주석 노드 하나와 양끝의 표시다", () => {
  assert.deepEqual(inline("a %%hi%% b"), [["Comment", "%%hi%%"], ["CommentMark", "%%"], ["CommentMark", "%%"]]);
});

test("주석 안은 마크다운이 아니다: 링크도 강조도 없고, 색인되지 않는다", () => {
  assert.deepEqual(inline("%%see [[note]] and *x*%%").map(([n]) => n), ["Comment", "CommentMark", "CommentMark"]);
  assert.deepEqual(linksIn("%%[[hidden]]%% [[shown]]").map((l) => l.target), ["shown"]);
});

test("닫히지 않거나 비어 있으면 글자다", () => {
  assert.deepEqual(inline("a %%hi b"), []);
  assert.deepEqual(inline("a %%%% b"), []);
});

test("코드 안에서는 글자일 뿐이다", () => {
  assert.deepEqual(inline("`%%x%%`").map(([n]) => n), ["InlineCode", "CodeMark", "CodeMark"]);
});

test("줄을 넘지 않는다", () => {
  assert.deepEqual(inline("a %%hi\nthere%% b").map(([n]) => n), ["Comment", "CommentMark", "CommentMark"], "a paragraph's lines are one inline run");
  assert.deepEqual(inline("%%open\n\nclosed%%"), [], "not across a blank line");
});
