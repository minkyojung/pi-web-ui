import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";

import { listNumbers } from "../web/src/features/listNumbers.ts";
import { fromServer } from "../web/src/features/origin.ts";

const at = (doc, cursor = doc.length) => {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage }), listNumbers] });
  assert.ok(ensureSyntaxTree(s, s.doc.length, 5000), "parsed whole");
  return s;
};
/** The doc and cursor after `spec` on `state`. */
const after = (state, spec) => {
  const s = state.update(spec).state;
  return [s.doc.toString(), s.selection.main.head];
};
/** The doc after `text` is typed at the cursor. */
const typed = (state, text) => after(state, { changes: { from: state.selection.main.head, insert: text }, selection: { anchor: state.selection.main.head + text.length }, userEvent: "input.type" });

test("리스트 밑에 친 1.은 그 리스트의 다음 번호가 된다", () => {
  assert.deepEqual(typed(at("9. a\n10. b\n"), "1. c"), ["9. a\n10. b\n11. c", 16]);
});

test("새 리스트의 첫 번호는 친 대로다", () => {
  assert.deepEqual(typed(at("text\n\n"), "5. a"), ["text\n\n5. a", 10]);
});

test("첫 항목의 번호를 고치면 나머지가 따라온다", () => {
  assert.deepEqual(after(at("1. a\n2. b\n3. c\n", 0), { changes: { from: 0, to: 1, insert: "4" }, userEvent: "input.type" })[0], "4. a\n5. b\n6. c\n");
});

test("가운데 항목의 번호는 고쳐도 제자리로 돌아온다", () => {
  assert.deepEqual(after(at("1. a\n2. b\n3. c\n", 5), { changes: { from: 5, to: 6, insert: "7" }, userEvent: "input.type" })[0], "1. a\n2. b\n3. c\n");
});

test("항목을 지우면 뒤가 당겨진다; 커서는 제자리다", () => {
  assert.deepEqual(after(at("1. a\n2. b\n3. c\n", 5), { changes: { from: 5, to: 10 }, selection: { anchor: 5 } }), ["1. a\n2. c\n", 5]);
});

test("안긴 리스트는 1부터다", () => {
  assert.deepEqual(typed(at("1. a\n    1. x\n"), "    5. y"), ["1. a\n    1. x\n    2. y", 22]);
});

test("리스트에 닿지 않은 변경은 아무것도 고치지 않는다", () => {
  assert.deepEqual(typed(at("1. a\n3. b\n\n\ntext", 16), "!"), ["1. a\n3. b\n\n\ntext!", 17]);
});

test("서버가 보낸 글과 조합 중인 글은 손대지 않는다", () => {
  const s = at("", 0);
  assert.equal(after(s, { changes: { from: 0, insert: "1. a\n3. b\n" }, annotations: fromServer.of(true) })[0], "1. a\n3. b\n");
  assert.equal(after(at("1. a\n3. b\n", 0), { changes: { from: 3, insert: "ㄱ" }, userEvent: "input.type.compose" })[0], "1. ㄱa\n3. b\n");
  assert.equal(after(at("1. a\n3. b\n", 0), { changes: { from: 3, insert: "가" }, userEvent: "input.type" })[0], "1. 가a\n2. b\n");
});

test("한 트랜잭션이다: 되돌리기 한 번에 번호도 돌아온다", () => {
  const s = at("9. a\n10. b\n");
  const tr = s.update({ changes: { from: s.doc.length, insert: "1. c" }, userEvent: "input.type" });
  assert.equal(tr.state.doc.toString(), "9. a\n10. b\n11. c");
  assert.equal(tr.changes.desc.toJSON !== undefined && tr.startState.doc.toString(), "9. a\n10. b\n", "one transaction from the old doc to the new");
  assert.equal(tr.annotation(Transaction.userEvent), "input.type");
});
