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

test("...로도 닫힌다", () => {
  assert.deepEqual(shape("---\na: 1\n...\ntext\n")[0], ["FrontMatter", 0, 12]);
});

test("맨 위가 아니면 CommonMark 그대로다 — 구분선, 그리고 ---가 밑줄이 된 제목", () => {
  assert.deepEqual(shape("text\n\n---\na: 1\n---\n").map(([n]) => n), ["Paragraph", "HorizontalRule", "SetextHeading2"]);
});

test("--- 뒤에 무엇이 더 붙으면 앞머리가 아니다", () => {
  assert.deepEqual(shape("--- \na: 1\n---\n").map(([n]) => n), ["HorizontalRule", "SetextHeading2"]);
});

test("닫히지 않으면 끝까지 앞머리다", () => {
  assert.deepEqual(shape("---\na: 1\nstill\n"), [["FrontMatter", 0, 15], ["FrontMatterMark", 0, 3]]);
});

test("앞머리 속 링크는 색인되지 않고, 본문의 것은 된다", () => {
  assert.deepEqual(linksIn("---\nrelated: [[hidden]]\n---\nsee [[shown]]\n").map((l) => l.target), ["shown"]);
});
