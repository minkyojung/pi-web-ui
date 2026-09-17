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

test("속성에 적은 태그도 색인에 든다 — 본문의 것과 한 목록으로, #을 떼고 소문자로", () => {
  const note = "---\ntags: [Reading, work]\n---\n\n#work and #inbody\n";
  assert.deepEqual(tagsIn(note), ["work", "inbody", "reading"]);
});

test("속성의 태그도 본문과 같은 이름 규칙을 따른다 — 숫자만은 태그가 아니다", () => {
  assert.deepEqual(tagsIn("---\ntags: [2024, a1, 'has space', ok/nested]\n---\n"), ["a1", "ok/nested"]);
});

test("한 줄로 쓴 tags, 여러 줄로 쓴 tags, #이 붙은 tags 모두 같은 태그다", () => {
  assert.deepEqual(tagsIn("---\ntags: reading\n---\n"), ["reading"]);
  assert.deepEqual(tagsIn("---\ntags:\n  - reading\n  - '#work'\n---\n"), ["reading", "work"]);
  assert.deepEqual(tagsIn("---\nTags: [Reading]\n---\n"), ["reading"], "이름의 대소문자는 가리지 않는다");
});

test("깨진 블록과 tags 아닌 속성은 태그를 내지 않는다", () => {
  assert.deepEqual(tagsIn("---\ntags: [x\n---\n"), []);
  assert.deepEqual(tagsIn("---\nstatus: draft\n---\n"), []);
});
