import assert from "node:assert/strict";
import test from "node:test";
import { ChangeSet, EditorState } from "@codemirror/state";

import { forget, observe, take } from "../web/src/features/moves.ts";

/** A person's transaction on a state, seen by observe the way the editor shows it: over the typing since the save. */
const step = (state, spec, standing) => {
  const tr = state.update(spec);
  observe({ changes: tr.changes, transactions: [tr] }, standing);
  return tr.state;
};
const identity = (length) => ChangeSet.empty(length).invertedDesc;
/** The edits a save would send for `local` over `saved`, with where each sits on screen. */
const editsOf = (local) => {
  const out = [];
  local.iterChanges((from, to, fromB, toB, inserted) => out.push({ from, to, insert: inserted.toString(), fromB, toB }));
  return out;
};

test("잘라낸 글을 붙여넣으면 저장의 그 편집에 어디서 왔는지가 적힌다", () => {
  forget();
  let state = EditorState.create({ doc: "one two three" });
  const standing = { path: "a.md", lines: 3, toBase: identity(13) };
  state = step(state, { changes: { from: 4, to: 8, insert: "" }, userEvent: "delete.cut" }, standing);
  // Pasted at the front, in a later transaction: the typing since the save is now the cut.
  const afterCut = ChangeSet.of({ from: 4, to: 8, insert: "" }, 13);
  state = step(state, { changes: { from: 0, to: 0, insert: "two " }, userEvent: "input.paste" }, { ...standing, toBase: afterCut.invertedDesc });
  assert.equal(state.doc.toString(), "two one three");
  const local = afterCut.compose(ChangeSet.of({ from: 0, to: 0, insert: "two " }, 9));
  const edits = take(editsOf(local));
  assert.deepEqual(edits.map((e) => [e.from, e.to, e.insert, e.moved]), [
    [0, 0, "two ", { path: "a.md", from: 4, to: 8, lines: 3 }],
    [4, 8, "", undefined],
  ]);
  assert.deepEqual(take(editsOf(local)).map((e) => e.moved), [undefined, undefined], "한 번 실린 것은 다시 실리지 않는다");
});

test("붙여넣은 자리는 그 뒤의 타이핑을 따라 움직이고, 다른 글은 붙여도 출처가 없다", () => {
  forget();
  let state = EditorState.create({ doc: "ab cd" });
  const standing = { path: "a.md", lines: 1, toBase: identity(5) };
  state = step(state, { changes: { from: 3, to: 5, insert: "" }, userEvent: "delete.cut" }, standing);
  let local = ChangeSet.of({ from: 3, to: 5, insert: "" }, 5);
  state = step(state, { changes: { from: 0, to: 0, insert: "cd" }, userEvent: "input.paste" }, { ...standing, toBase: local.invertedDesc });
  local = local.compose(ChangeSet.of({ from: 0, to: 0, insert: "cd" }, 3));
  // Typing in front of the paste moves it along; the edit that holds it is the one with both.
  state = step(state, { changes: { from: 0, to: 0, insert: "XX" }, userEvent: "input.type" }, { ...standing, toBase: local.invertedDesc });
  local = local.compose(ChangeSet.of({ from: 0, to: 0, insert: "XX" }, 5));
  assert.equal(state.doc.toString(), "XXcdab ");
  const [first] = take(editsOf(local));
  assert.equal(first.insert, "XXcd");
  assert.deepEqual(first.moved, { path: "a.md", from: 3, to: 5, lines: 1 });
  // Other words pasted are nobody's but the paster's.
  state = step(state, { changes: { from: 0, to: 0, insert: "zz" }, userEvent: "input.paste" }, { ...standing, toBase: identity(7) });
  assert.deepEqual(take(editsOf(ChangeSet.of({ from: 0, to: 0, insert: "zz" }, 7))).map((e) => e.moved), [undefined]);
});

test("끌어 놓기는 한 트랜잭션 안의 잘라내기와 붙여넣기다; 노트가 오기 전에는 출처를 모른다", () => {
  forget();
  let state = EditorState.create({ doc: "one two" });
  const standing = { path: "a.md", lines: 2, toBase: identity(7) };
  state = step(state, { changes: [{ from: 0, to: 4, insert: "" }, { from: 7, to: 7, insert: "one " }], userEvent: "move.drop" }, standing);
  assert.equal(state.doc.toString(), "twoone ");
  const local = ChangeSet.of([{ from: 0, to: 4, insert: "" }, { from: 7, to: 7, insert: "one " }], 7);
  const edits = take(editsOf(local));
  assert.deepEqual(edits.find((e) => e.insert === "one ").moved, { path: "a.md", from: 0, to: 4, lines: 2 });
  // No log length yet: a cut then is a cut of words the record cannot be asked about.
  forget();
  let s2 = EditorState.create({ doc: "one two" });
  s2 = step(s2, { changes: { from: 0, to: 4, insert: "" }, userEvent: "delete.cut" }, { ...standing, lines: null });
  s2 = step(s2, { changes: { from: 3, to: 3, insert: "one " }, userEvent: "input.paste" }, { ...standing, lines: null, toBase: identity(3) });
  assert.deepEqual(take(editsOf(ChangeSet.of({ from: 3, to: 3, insert: "one " }, 3))).map((e) => e.moved), [undefined]);
});
