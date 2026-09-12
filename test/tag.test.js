import assert from "node:assert/strict";
import test from "node:test";

import { tagsIn } from "../links.ts";
import { parser } from "../syntax.ts";

/** The tags in `text`, as their text. */
const tagNodes = (text) => {
  const out = [];
  parser.parse(text).iterate({ enter: (n) => { if (n.name === "Tag") out.push(text.slice(n.from, n.to)); } });
  return out;
};

test("#태그는 공백 뒤나 줄 머리에서, 글자·숫자·_·-·/로 이어진다", () => {
  assert.deepEqual(tagNodes("#a b #b_c-d/e f #한글"), ["#a", "#b_c-d/e", "#한글"]);
});

test("숫자만으로는 태그가 아니다 — Obsidian의 규칙", () => {
  assert.deepEqual(tagNodes("#1 #2024 #a1"), ["#a1"]);
});

test("헤딩, 낱말 속, 코드, URL 속의 #은 태그가 아니다", () => {
  assert.deepEqual(tagNodes("# heading\n"), []);
  assert.deepEqual(tagNodes("a#b"), []);
  assert.deepEqual(tagNodes("`#x`"), []);
  assert.deepEqual(tagNodes("see https://x.y/page#frag now"), []);
});

test("태그의 #은 표시 노드다", () => {
  const out = [];
  parser.parse("#a").iterate({ enter: (n) => { if (n.name === "TagMark") out.push([n.from, n.to]); } });
  assert.deepEqual(out, [[0, 1]]);
});

test("색인용 태그는 #을 떼고 소문자로, 노트마다 한 번씩", () => {
  assert.deepEqual(tagsIn("#Work #work #a/b `#no` #1"), ["work", "a/b"]);
});
