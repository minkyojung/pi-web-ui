import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";

import { noteSyntax } from "../syntax.ts";
import { livePreview } from "../web/src/features/livePreview.ts";
import { fromServer } from "../web/src/features/origin.ts";
import { properties, propertiesEdit, propertiesField } from "../web/src/features/properties.ts";

const NOTE = "---\na: 1\ntags: [x]\n---\nbody\n";
const BODY = NOTE.indexOf("body");

const state = (doc = NOTE, cursor = doc.length) => {
  const s = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage, extensions: [noteSyntax] }), livePreview, properties],
  });
  assert.ok(ensureSyntaxTree(s, s.doc.length, 5000), "parsed whole");
  return s;
};

test("에디터의 트리에서 블록을 읽는다; 없으면 없다", () => {
  const read = state().field(propertiesField);
  assert.deepEqual(read.block, { from: 0, to: 22, yaml: { from: 4, to: 19 } });
  assert.equal(read.doc.get("a"), 1);
  assert.deepEqual(read.doc.get("tags").toJSON(), ["x"]);
  assert.deepEqual(state("body\n").field(propertiesField), { block: null });
});

test("본문을 치면 속성은 같은 값 그대로고, 블록을 치면 새로 읽는다", () => {
  const s = state();
  const was = s.field(propertiesField);
  assert.equal(s.update({ changes: { from: s.doc.length, insert: "more" }, annotations: fromServer.of(true) }).state.field(propertiesField), was);
  const edited = s.update({ changes: { from: 7, to: 8, insert: "2" }, annotations: propertiesEdit.of(true) }).state.field(propertiesField);
  // The block without its newline is not a block; nothing may be typed onto its closing fence either.
  const bare = state("---\na: 1\n---");
  assert.equal(bare.update({ changes: { from: bare.doc.length, insert: "x" } }).state.doc.toString(), "---\na: 1\n---");
  assert.notEqual(edited, was);
  assert.equal(edited.doc.get("a"), 2);
});

test("커서는 블록에 들어가지 못하고 본문 첫머리로 간다", () => {
  const s = state();
  assert.equal(s.update({ selection: { anchor: 0 } }).state.selection.main.head, BODY);
  assert.equal(s.update({ selection: { anchor: 7 } }).state.selection.main.head, BODY);
  // A selection reaching in is cut at the text; one wholly in the text is left alone.
  const cut = s.update({ selection: EditorSelection.range(2, s.doc.length) }).state.selection.main;
  assert.deepEqual([cut.anchor, cut.head], [BODY, s.doc.length]);
  assert.equal(s.update({ selection: { anchor: BODY + 2 } }).state.selection.main.head, BODY + 2);
});

test("글 전체가 바뀌면서 커서가 블록에 놓여도 — 서버가 보낸 노트처럼 — 본문 첫머리로 간다", () => {
  const s = state("short\n");
  const longer = "---\nkey: value\ntags: [x, y]\n---\n\n# a longer note\n";
  const next = s.update({ changes: { from: 0, to: s.doc.length, insert: longer }, selection: { anchor: 0 }, annotations: fromServer.of(true) }).state;
  assert.equal(next.doc.toString(), longer);
  assert.equal(next.selection.main.head, longer.indexOf("---\n\n") + 4);
});

test("본문 첫머리의 Backspace는 블록을 건드리지 못한다; 첫머리에 치는 글자는 된다", () => {
  const s = state();
  assert.equal(s.update({ changes: { from: BODY - 1, to: BODY } }).state.doc.toString(), NOTE, "the closing fence's newline stays");
  assert.equal(s.update({ changes: { from: 5, to: 6, insert: "b" } }).state.doc.toString(), NOTE, "nothing inside changes");
  assert.equal(s.update({ changes: { from: BODY, insert: "x" } }).state.doc.toString(), NOTE.replace("body", "xbody"));
});

test("패널의 변경, 서버의 변경, 되돌리기는 블록을 바꿀 수 있다", () => {
  const s = state();
  const change = { from: 4, to: 5, insert: "b" };
  assert.equal(s.update({ changes: change, annotations: propertiesEdit.of(true) }).state.doc.toString(), NOTE.replace("a: 1", "b: 1"));
  assert.equal(s.update({ changes: change, annotations: fromServer.of(true) }).state.doc.toString(), NOTE.replace("a: 1", "b: 1"));
  assert.equal(s.update({ changes: change, userEvent: "undo" }).state.doc.toString(), NOTE.replace("a: 1", "b: 1"));
});
