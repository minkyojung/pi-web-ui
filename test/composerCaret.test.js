import assert from "node:assert/strict";
import test from "node:test";

import { getSchema } from "@tiptap/core";
import { EditorState, Selection } from "@tiptap/pm/state";

import { lineBefore } from "../web/src/composer/caret.ts";
import { extensions } from "../web/src/composer/schema.ts";
import { CHIP, textToDoc } from "../web/src/composer/text.ts";
import { mentionQuery } from "../web/src/noteMention.ts";

const schema = getSchema(extensions);
const isFile = (path) => path === "notes/a.md";
/** A state of `text` with the caret at its end, where the `|` is written. */
const at = (marked) => {
  const doc = schema.nodeFromJSON(textToDoc(marked.replace(/\|$/, ""), isFile));
  return EditorState.create({ schema, doc, selection: Selection.atEnd(doc) });
};

test("커서 앞의 줄을 글로 읽고, 그 글의 자리가 곧 문서의 자리다", () => {
  const state = at("첫 줄\n둘째 @no|");
  const { text, start } = lineBefore(state);
  assert.equal(text, "둘째 @no");
  const query = mentionQuery(text, text.length);
  assert.deepEqual(query, { from: 3, query: "no" });
  assert.equal(state.doc.textBetween(start + query.from, state.selection.from), "@no", "찾은 자리부터 커서까지가 친 @단어");
});

test("칩은 한 글자로 세어져서, 칩 뒤의 @단어도 자리가 맞는다", () => {
  const state = at("@notes/a.md 와 @q|");
  const { text, start } = lineBefore(state);
  assert.equal(text, "￼ 와 @q");
  const query = mentionQuery(text, text.length);
  assert.equal(state.doc.textBetween(start + query.from, state.selection.from), "@q");
  assert.equal(state.doc.firstChild.firstChild.type.name, CHIP);
});

test("칩 바로 뒤의 @는 멘션이 아니다", () => {
  const state = at("@notes/a.md@|");
  assert.equal(mentionQuery(lineBefore(state).text, lineBefore(state).text.length), null);
});
