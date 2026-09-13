import assert from "node:assert/strict";
import test from "node:test";

import { pickedCompletion } from "@codemirror/autocomplete";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";

import { applyTitle, source } from "../web/src/features/linkCompletion.ts";

const notes = () => ["first.md", "ideas/second.md"];
const state = (doc, cursor = doc.length) => EditorState.create({ doc, selection: EditorSelection.cursor(cursor) });
const offered = (doc, cursor) => source(notes)(new CompletionContext(state(doc, cursor), cursor ?? doc.length, false));

test("[[ 뒤에서 노트를 제목으로 내놓고, 폴더는 곁에 적는다; 그 밖에서는 아무것도", () => {
  const r = offered("see [[fi");
  assert.equal(r.from, 6);
  assert.deepEqual(r.options.map((o) => [o.label, o.detail]), [["first", undefined], ["second", "ideas"]]);
  assert.equal(offered("see [fi"), null);
  assert.equal(offered("see [[done]] and"), null);
});

/** A fake view: the state, and what was dispatched. */
const view = (s) => ({ state: s, dispatched: null, dispatch(spec) { this.dispatched = spec; } });
const applied = (doc, cursor, from, to, label = "first") => {
  const v = view(state(doc, cursor));
  applyTitle(v, { label }, from, to);
  const tr = v.state.update(v.dispatched);
  return { doc: tr.state.doc.toString(), cursors: tr.state.selection.ranges.map((r) => r.head), picked: tr.annotation(pickedCompletion)?.label, event: tr.annotation(Transaction.userEvent) };
};

test("고르면 제목이 들어가고 ]]가 닫히며, 커서는 그 뒤에 선다", () => {
  assert.deepEqual(applied("see [[fi", 8, 6, 8), { doc: "see [[first]]", cursors: [13], picked: "first", event: "input.complete" });
});

test("closeBrackets가 이미 ]]를 넣어 두었으면 그 위로 건너간다", () => {
  assert.deepEqual(applied("see [[fi]] x", 8, 6, 8), { doc: "see [[first]] x", cursors: [13], picked: "first", event: "input.complete" });
});

test("같은 글자를 앞에 둔 커서마다 들어간다", () => {
  const s = EditorState.create({ doc: "[[fi\n[[fi", selection: EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(9)], 0), extensions: EditorState.allowMultipleSelections.of(true) });
  const v = view(s);
  applyTitle(v, { label: "first" }, 2, 4);
  const out = v.state.update(v.dispatched).state;
  assert.equal(out.doc.toString(), "[[first]]\n[[first]]");
  assert.deepEqual(out.selection.ranges.map((r) => r.head), [9, 19]);
});
