import assert from "node:assert/strict";
import test from "node:test";

import { bodyStart, listOf, propertiesOf, renameProperty, suits, withProperties, writtenIn } from "../properties.ts";

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

test("노트가 쓴 속성의 이름과, 그 아래 값들", () => {
  assert.deepEqual(writtenIn(NOTE), [
    { name: "title", values: ["Quoted title"] },
    { name: "date", values: ["2024-01-01"] },
    { name: "version", values: ["1.10"] },
    { name: "answer", values: ["no"] },
    { name: "tags", values: ["work", "weekly"] },
    { name: "aliases", values: ["meeting"] },
    { name: "related", values: ["[[other]]"] },
    { name: "한글 키", values: ["값"] },
    // 여러 줄에 걸친 값은 한 줄짜리 칸이 제안할 것이 아니다. 이름은 그래도 이름이다.
    { name: "body", values: [] },
  ]);
});

test("깨진 블록과 블록 없는 노트는 아무 이름도 말하지 않는다", () => {
  assert.deepEqual(writtenIn("---\ntags: [x\n---\nbody\n"), []);
  assert.deepEqual(writtenIn("# hi\n"), []);
  assert.deepEqual(writtenIn("---\n- a\n- b\n---\n"), []);
});

test("숫자는 글자로, 참거짓·빈 값·중첩은 제안할 값이 아니다", () => {
  assert.deepEqual(writtenIn("---\ncount: 3\ndone: true\nempty:\nnested:\n  a: 1\n---\n"), [
    { name: "count", values: ["3"] },
    { name: "done", values: [] },
    { name: "empty", values: [] },
    { name: "nested", values: [] },
  ]);
});

test("친 글자와 꼭 같은 것이 먼저, 앞자리가 맞는 것이 다음, 안에 든 것이 그다음", () => {
  assert.ok(suits("date", "date") > suits("dateline", "date"));
  assert.ok(suits("dateline", "date") > suits("updated", "date"));
  assert.ok(suits("updated", "date") > 0);
  assert.equal(suits("tags", "date"), 0);
  assert.ok(suits("Status", "st") > 0, "대소문자는 가리지 않는다");
  assert.ok(suits("아무거나", "") > 0, "아무것도 치지 않았으면 다 나온다");
});

test("이름을 바꾸면 그 줄만 다시 써지고, 값과 자리와 나머지 줄은 그대로다", () => {
  const note = "---\n# why\ntitle: 'kept'   # here\nstatus: draft\nother: 1\n---\nbody\n";
  const r = withProperties(note, (doc) => renameProperty(doc, "status", "state"));
  assert.equal(r.text, "---\n# why\ntitle: 'kept'   # here\nstate: draft\nother: 1\n---\nbody\n");
});

test("목록 값도 그대로 따라간다", () => {
  assert.equal(withProperties("---\ntags: [a, b]\n---\n", (doc) => renameProperty(doc, "tags", "topics")).text, "---\ntopics: [a, b]\n---\n");
});

test("새 이름에 따옴표가 필요하면 붙는다 — 무엇에 필요한지는 라이브러리가 정한다", () => {
  const r = withProperties("---\na: 1\n---\n", (doc) => renameProperty(doc, "a", "to do: today"));
  assert.equal(propertiesOf(r.text).errors.length, 0, "블록은 여전히 읽힌다");
  assert.deepEqual(propertiesOf(r.text).doc.toJS(), { "to do: today": 1 });
});

test("이미 있는 이름으로는 바꾸지 않는다 — 같은 키가 둘이면 블록이 깨지므로", () => {
  const note = "---\na: 1\nb: 2\n---\n";
  assert.equal(withProperties(note, (doc) => renameProperty(doc, "a", "b")).text, note, "아무것도 바뀌지 않는다");
  assert.equal(withProperties(note, (doc) => renameProperty(doc, "a", "  ")).text, note, "빈 이름도 마찬가지");
});

test("대소문자만 고치는 것은 자기 자신이므로 허용한다", () => {
  assert.equal(withProperties("---\nStatus: draft\n---\n", (doc) => renameProperty(doc, "Status", "status")).text, "---\nstatus: draft\n---\n");
});

test("없는 이름을 바꾸라면 아무 일도 없다", () => {
  const note = "---\na: 1\n---\n";
  assert.equal(withProperties(note, (doc) => renameProperty(doc, "nope", "x")).text, note);
});
