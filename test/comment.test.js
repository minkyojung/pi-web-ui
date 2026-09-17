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

test("한 줄 안의 주석은 문단의 줄을 넘되 빈 줄은 넘지 않는다", () => {
  assert.deepEqual(inline("a %%hi\nthere%% b").map(([n]) => n), ["Comment", "CommentMark", "CommentMark"], "a paragraph's lines are one inline run");
  assert.deepEqual(inline("%%open\n\nclosed%%"), [], "not across a blank line");
});

/** The top-level nodes of `text`, as [name, from, to]; a comment block's marks under it. */
const blocks = (text) => {
  const out = [];
  parser.parse(text).iterate({
    enter: (n) => {
      if (n.name === "Document") return;
      out.push([n.name, n.from, n.to]);
      return n.name === "BlockComment" ? undefined : false;
    },
  });
  return out;
};

test("%%만 있는 줄은 블록 주석을 열고, 빈 줄과 블록을 넘어 다음 %% 줄에서 닫힌다", () => {
  assert.deepEqual(blocks("%%\none\n\n# two\n%%\nafter\n"), [
    ["BlockComment", 0, 16], ["CommentMark", 0, 2], ["CommentMark", 14, 16],
    ["Paragraph", 17, 22],
  ]);
});

test("문단 바로 아래의 %% 줄은 문단을 끊고 블록 주석이 된다, 펜스처럼", () => {
  assert.deepEqual(blocks("text\n%%\nhidden\n%%\n").map(([n]) => n), ["Paragraph", "BlockComment", "CommentMark", "CommentMark"]);
});

test("블록 주석 안의 링크는 색인되지 않는다", () => {
  assert.deepEqual(linksIn("%%\n[[hidden]]\n%%\n[[shown]]\n").map((l) => l.target), ["shown"]);
});

test("닫히지 않으면 끝까지 주석이다", () => {
  assert.deepEqual(blocks("%%\nstill\n\nmore\n"), [["BlockComment", 0, 15], ["CommentMark", 0, 2]]);
});

test("%% 뒤에 무엇이 더 붙으면 여는 줄이 아니다; 그 아래의 %%는 연다", () => {
  assert.deepEqual(blocks("%% x\n\n%%\n").map(([n]) => n), ["Paragraph", "BlockComment", "CommentMark"]);
});
