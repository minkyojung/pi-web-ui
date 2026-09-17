import assert from "node:assert/strict";
import test from "node:test";

import { parser as markdown } from "@lezer/markdown";

import { frontMatter } from "../frontmatter.ts";
import { linksIn } from "../links.ts";

const parser = markdown.configure([frontMatter]);
/** The top-level nodes of `text`, as [name, from, to]; the front matter's marks under it. */
const shape = (text) => {
  const out = [];
  parser.parse(text).iterate({
    enter: (n) => {
      if (n.name === "Document") return;
      out.push([n.name, n.from, n.to]);
      return n.name === "FrontMatter" ? undefined : false;
    },
  });
  return out;
};

test("맨 위의 --- 블록은 하나의 노드이고, 두 줄의 표시를 가진다", () => {
  assert.deepEqual(shape("---\ntitle: a\n---\n\n# hi\n"), [
    ["FrontMatter", 0, 16], ["FrontMatterMark", 0, 3], ["FrontMatterMark", 13, 16],
    ["ATXHeading1", 18, 22],
  ]);
});

test("...는 닫지 않는다 — Obsidian과 CommonMark 쪽 파서들이 그렇듯, 닫는 줄은 여는 줄과 같다", () => {
  assert.deepEqual(shape("---\na: 1\n...\ntext\n---\n"), [["FrontMatter", 0, 21], ["FrontMatterMark", 0, 3], ["FrontMatterMark", 18, 21]]);
  assert.deepEqual(shape("---\na: 1\n...\ntext\n").map(([n]) => n), ["HorizontalRule", "Paragraph"]);
});

test("맨 위가 아니면 CommonMark 그대로다 — 구분선, 그리고 ---가 밑줄이 된 제목", () => {
  assert.deepEqual(shape("text\n\n---\na: 1\n---\n").map(([n]) => n), ["Paragraph", "HorizontalRule", "SetextHeading2"]);
});

test("--- 뒤에 무엇이 더 붙으면 앞머리가 아니다", () => {
  assert.deepEqual(shape("--- \na: 1\n---\n").map(([n]) => n), ["HorizontalRule", "SetextHeading2"]);
});

test("닫히지 않으면 앞머리가 아니다 — 구분선과 글", () => {
  assert.deepEqual(shape("---\na: 1\nstill\n").map(([n]) => n), ["HorizontalRule", "Paragraph"]);
  // 닫는 줄에 무엇이 더 붙어도 닫지 않는다.
  assert.deepEqual(shape("---\na: 1\n--- \nstill\n").map(([n]) => n), ["HorizontalRule", "SetextHeading2", "Paragraph"]);
});

test("빈 블록도 블록이다", () => {
  assert.deepEqual(shape("---\n---\nbody\n"), [["FrontMatter", 0, 7], ["FrontMatterMark", 0, 3], ["FrontMatterMark", 4, 7], ["Paragraph", 8, 12]]);
});

test("CRLF 노트의 울타리도 울타리다", () => {
  // The node ends after the closing fence's `\r`, as the line does.
  assert.deepEqual(shape("---\r\na: 1\r\n---\r\nbody\r\n")[0], ["FrontMatter", 0, 15]);
});

test("앞머리 속 링크는 색인되지 않고, 본문의 것은 된다", () => {
  assert.deepEqual(linksIn("---\nrelated: [[hidden]]\n---\nsee [[shown]]\n").map((l) => l.target), ["shown"]);
});
