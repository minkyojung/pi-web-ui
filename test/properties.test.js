import assert from "node:assert/strict";
import test from "node:test";

import { bodyStart, listOf, propertiesOf, withProperties } from "../properties.ts";

const NOTE = `---
# a comment on top
title: "Quoted title"   # trailing
date: 2024-01-01
version: "1.10"
answer: no
tags: [work, weekly]
aliases:
  - meeting
related: "[[other]]"
한글 키: 값

body: |
  line one
  line two
---

# Heading

text
`;

test("블록이 없으면 없다고 한다", () => {
  assert.deepEqual(propertiesOf("# just a note\n"), { block: null });
  assert.deepEqual(propertiesOf("\n---\na: 1\n---\n"), { block: null });
});

test("블록의 자리와 그 안의 YAML의 자리", () => {
  const p = propertiesOf("---\na: 1\n---\nbody\n");
  assert.deepEqual(p.block, { from: 0, to: 12, yaml: { from: 4, to: 9 } });
  assert.equal(p.errors.length, 0);
  assert.deepEqual(p.doc.toJS(), { a: 1 });
});

test("값은 문자열이다: 날짜, 따옴표 친 버전, no", () => {
  const { doc } = propertiesOf(NOTE);
  assert.equal(doc.get("date"), "2024-01-01");
  assert.equal(doc.get("version"), "1.10");
  assert.equal(doc.get("answer"), "no");
  assert.equal(doc.get("related"), "[[other]]");
});

test("값 하나를 바꾸면 그 줄만 바뀐다 — 주석, 따옴표, 순서, 빈 줄, 블록 스칼라 그대로", () => {
  const r = withProperties(NOTE, (doc) => doc.set("title", "Changed"));
  assert.equal(r.ok, true);
  assert.equal(r.text, NOTE.replace('title: "Quoted title"   # trailing', 'title: "Changed" # trailing'));
});

test("속성을 더하면 마지막 줄 뒤에 붙고, 지우면 그 줄이 사라진다", () => {
  const added = withProperties(NOTE, (doc) => doc.set("status", "draft"));
  assert.equal(added.text, NOTE.replace("  line two\n---", "  line two\nstatus: draft\n---"));
  const removed = withProperties(NOTE, (doc) => doc.delete("answer"));
  assert.equal(removed.text, NOTE.replace("answer: no\n", ""));
});

test("쓸 때 오해될 값에는 따옴표가 붙는다 — 링크, 태그 기호, 버전, 콜론; 날짜는 붙지 않는다", () => {
  const r = withProperties("---\na: 1\n---\n", (doc) => {
    doc.set("link", "[[a]]");
    doc.set("hash", "#x");
    doc.set("ver", "1.10");
    doc.set("colon", "a: b");
    doc.set("date", "2024-01-01");
  });
  assert.equal(r.text, '---\na: 1\nlink: "[[a]]"\nhash: "#x"\nver: "1.10"\ncolon: "a: b"\ndate: 2024-01-01\n---\n');
});

test("깨진 블록에는 쓰지 않는다", () => {
  const broken = "---\ntags: [work\n---\nbody\n";
  const p = propertiesOf(broken);
  assert.ok(p.errors.length > 0);
  assert.deepEqual(withProperties(broken, (doc) => doc.set("a", 1)), { ok: false, reason: "invalid" });
  const dup = "---\na: 1\na: 2\n---\n";
  assert.ok(propertiesOf(dup).errors.length > 0);
  assert.deepEqual(withProperties(dup, () => {}), { ok: false, reason: "invalid" });
});

test("매핑이 아닌 블록은 깨진 것이다", () => {
  assert.ok(propertiesOf("---\n- a\n---\n").errors.length > 0);
  assert.ok(propertiesOf("---\njust words\n---\n").errors.length > 0);
});

test("블록이 없는 노트에는 첫 줄에 만든다; 본문은 그대로", () => {
  const r = withProperties("# Heading\n\ntext\n", (doc) => doc.set("tags", ["a"]));
  assert.equal(r.text, "---\ntags:\n  - a\n---\n# Heading\n\ntext\n");
  // 본문이 구분선으로 시작해도 그 구분선은 본문의 것이다.
  const rule = withProperties("---\n\ntext\n", (doc) => doc.set("a", 1));
  assert.equal(rule.text, "---\na: 1\n---\n---\n\ntext\n");
  assert.equal(propertiesOf(rule.text).doc.get("a"), 1);
});

test("빈 블록에 넣고, 마지막 속성을 지우면 블록이 사라진다", () => {
  const filled = withProperties("---\n---\nbody\n", (doc) => doc.set("a", 1));
  assert.equal(filled.text, "---\na: 1\n---\nbody\n");
  const emptied = withProperties("---\na: 1\n---\nbody\n", (doc) => doc.delete("a"));
  assert.equal(emptied.text, "body\n");
  assert.equal(withProperties("---\na: 1\n---", (doc) => doc.delete("a")).text, "");
});

test("본문 속 ---는 건드리지 않는다", () => {
  const note = "---\na: 1\n---\nabove\n\n---\n\nbelow\n---\n";
  const r = withProperties(note, (doc) => doc.set("a", 2));
  assert.equal(r.text, note.replace("a: 1", "a: 2"));
});

test("모르는 키, 중첩 객체, 비어 있는 값은 그대로 남는다", () => {
  const note = "---\nauthor:\n  name: x\n  email: y\nempty:\ntilde: ~\nweird key here: 1\n---\n";
  const r = withProperties(note, (doc) => doc.set("added", true));
  assert.equal(r.text, note.replace("weird key here: 1\n", "weird key here: 1\nadded: true\n"));
});

test("한 값이든 한 줄 목록이든 여러 줄 목록이든 같은 목록이다; #은 뗀다", () => {
  const read = (yaml) => listOf(propertiesOf(`---\n${yaml}\n---\n`).doc, "tags");
  assert.deepEqual(read("tags: a"), ["a"]);
  assert.deepEqual(read("tags: [a, b]"), ["a", "b"]);
  assert.deepEqual(read("tags:\n  - a\n  - b"), ["a", "b"]);
  assert.deepEqual(read("tags: ['#a', 2024]"), ["a", "2024"]);
  assert.deepEqual(read("tags:"), []);
  assert.deepEqual(read("other: a"), []);
  assert.deepEqual(read("tags: [{a: 1}, b]"), ["b"]);
});

test("CRLF 노트는 읽히고, 쓰면 블록은 LF가 된다", () => {
  const p = propertiesOf("---\r\na: 1\r\n---\r\nbody\r\n");
  assert.equal(p.doc.get("a"), 1);
  const r = withProperties("---\r\na: 1\r\n---\r\nbody\r\n", (doc) => doc.set("a", 2));
  assert.equal(r.text, "---\r\na: 2\n---\r\nbody\r\n");
});

test("주석이 위에 달린 키를 바꿔도 주석은 한 번만, 제자리에", () => {
  const note = "---\n# why this matters\nstatus: draft   # for now\nother: 1\n# the end\n---\nbody\n";
  const r = withProperties(note, (doc) => doc.set("status", "done"));
  assert.equal(r.text, "---\n# why this matters\nstatus: done # for now\nother: 1\n# the end\n---\nbody\n");
  // 새 키는 끝 주석 앞이 아니라, 마지막 속성 뒤 끝 주석 앞에 — 끝 주석은 여전히 끝이다.
  const added = withProperties(note, (doc) => doc.set("new", "x"));
  assert.equal(added.text, "---\n# why this matters\nstatus: draft   # for now\nother: 1\n# the end\nnew: x\n---\nbody\n");
});

test("지운 키의 위 주석은 같이 가고, 남은 키의 위 주석은 남는다", () => {
  const note = "---\n# about a\na: 1\n\n# about b\nb: 2\n---\n";
  assert.equal(withProperties(note, (doc) => doc.delete("a")).text, "---\n\n# about b\nb: 2\n---\n");
  assert.equal(withProperties(note, (doc) => doc.delete("b")).text, "---\n# about a\na: 1\n---\n");
});

test("목록에 하나를 더하면 그 목록만 다시 써진다", () => {
  const note = "---\ntitle: 'kept'   # here\ntags:\n  - a\n---\n";
  const r = withProperties(note, (doc) => doc.get("tags").add("b"));
  assert.equal(r.text, "---\ntitle: 'kept'   # here\ntags:\n  - a\n  - b\n---\n");
});

test("본문은 블록 아래에서 시작한다; 블록이 없으면 맨 위", () => {
  assert.equal(bodyStart("---\na: 1\n---\n# hi\n"), 13);
  assert.equal(bodyStart("---\na: 1\n---"), 12);
  assert.equal(bodyStart("# hi\n"), 0);
  assert.equal(bodyStart("---\na: 1\nunclosed\n"), 0);
});

test("값 없이 더한 속성은 `이름:` 한 줄이다", () => {
  assert.equal(withProperties("---\na: 1\n---\n", (doc) => doc.set("k", null)).text, "---\na: 1\nk:\n---\n");
});
