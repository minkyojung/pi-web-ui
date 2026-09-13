import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";

import { indentListItem, listBackspace, listEnter, outdentListItem, renumbered } from "../web/src/features/listEdit.ts";

/** A state with the cursor at `cursor`, the whole tree parsed, four-space indent as the editor has it. */
const at = (doc, cursor) => {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage }), indentUnit.of("    ")] });
  assert.ok(ensureSyntaxTree(s, s.doc.length, 5000), "parsed whole");
  return s;
};
/** The doc and cursor after `command` — as they were, when it used the key up without a change — or null when it passed the key on. */
const after = (command, state) => {
  let out = [state.doc.toString(), state.selection.main.head];
  const ran = command({ state, dispatch: (tr) => { const s = state.update(tr).state; out = [s.doc.toString(), s.selection.main.head]; } });
  return ran ? out : null;
};

test("Enter는 항목을 잇는다", () => {
  assert.deepEqual(after(listEnter, at("- a", 3)), ["- a\n- ", 6]);
  assert.deepEqual(after(listEnter, at("1. a", 4)), ["1. a\n2. ", 8]);
  assert.deepEqual(after(listEnter, at("- [x] a", 7)), ["- [x] a\n- [ ] ", 14]);
});

test("빈 항목에서 Enter는 리스트를 끝낸다, 둘뿐인 리스트에서도", () => {
  assert.deepEqual(after(listEnter, at("- a\n- ", 6)), ["- a\n", 4]);
  assert.deepEqual(after(listEnter, at("- [ ] a\n- [ ] ", 14)), ["- [ ] a\n", 8]);
});

test("안긴 빈 항목에서 Enter는 한 단계 밖으로 나온다", () => {
  assert.deepEqual(after(listEnter, at("- a\n    - b\n    - ", 18)), ["- a\n    - b\n- ", 14]);
  assert.deepEqual(after(listEnter, at("1. a\n    1. b\n    2. ", 21)), ["1. a\n    1. b\n2. ", 17]);
});

test("글 가운데의 Enter는 뒤 공백을 새 항목에 남기지 않는다", () => {
  assert.deepEqual(after(listEnter, at("- hello world", 7)), ["- hello\n- world", 10]);
  assert.deepEqual(after(listEnter, at("- hello world", 8)), ["- hello\n- world", 10]);
});

test("리스트 밖의 Enter는 넘긴다", () => {
  assert.equal(after(listEnter, at("text", 4)), null);
});

test("마커 바로 뒤의 Backspace는 마커와 그 앞 들여쓰기를 함께 지운다", () => {
  assert.deepEqual(after(listBackspace, at("- a\n- ", 6)), ["- a\n", 4]);
  assert.deepEqual(after(listBackspace, at("- a\n    - ", 10)), ["- a\n", 4]);
  assert.deepEqual(after(listBackspace, at("- a\n- b", 6)), ["- a\nb", 4]);
  assert.deepEqual(after(listBackspace, at("- [ ] a", 6)), ["a", 0]);
});

test("마커 뒤가 아니면 Backspace는 넘긴다", () => {
  assert.equal(after(listBackspace, at("- ab", 4)), null);
  assert.equal(after(listBackspace, at("- [ ] a", 2)), null);
  assert.equal(after(listBackspace, at("- a\n  ", 6)), null);
  assert.equal(after(listBackspace, at("text", 2)), null);
});

test("리스트 밖의 Tab은 넘기고, 선택이 있으면 넘긴다", () => {
  assert.equal(after(indentListItem, at("text", 2)), null);
  assert.equal(after(outdentListItem, at("text", 2)), null);
});

test("Tab은 항목을 한 단계 안기고, 안긴 항목은 1부터, 남은 항목들은 이어서 번호가 매겨진다", () => {
  assert.deepEqual(after(indentListItem, at("1. a\n2. b\n3. c\n", 6)), ["1. a\n    1. b\n2. c\n", 10]);
});

test("Shift-Tab은 항목을 한 단계 빼고, 합쳐진 리스트를 다시 매긴다", () => {
  assert.deepEqual(after(outdentListItem, at("1. a\n    1. b\n2. c\n", 10)), ["1. a\n2. b\n3. c\n", 6]);
});

test("불릿 항목도 안기고 빼지며, 번호는 건드릴 것이 없다", () => {
  assert.deepEqual(after(indentListItem, at("- a\n- b\n", 5)), ["- a\n    - b\n", 9]);
  assert.deepEqual(after(outdentListItem, at("- a\n    - b\n", 9)), ["- a\n- b\n", 5]);
});

test("Tab은 항목 전체를 옮긴다: 안긴 리스트와 이어지는 줄이 같이 간다", () => {
  assert.deepEqual(after(indentListItem, at("- a\n- b\n    - c\n- d\n", 5)), ["- a\n    - b\n        - c\n- d\n", 9]);
  assert.deepEqual(after(outdentListItem, at("- a\n    - b\n        - c\n- d\n", 9)), ["- a\n- b\n    - c\n- d\n", 5]);
  assert.deepEqual(after(indentListItem, at("- a\n- b\n  more\n", 5)), ["- a\n    - b\n      more\n", 9]);
});

test("리스트의 첫 항목은 들어갈 곳이 없고 맨 위 항목은 나갈 곳이 없어, 키만 먹고 그대로다", () => {
  assert.deepEqual(after(indentListItem, at("1. a\n2. b\n", 2)), ["1. a\n2. b\n", 2]);
  assert.deepEqual(after(indentListItem, at("- a\n    - b\n", 9)), ["- a\n    - b\n", 9]);
  assert.deepEqual(after(outdentListItem, at("- a\n- b\n", 5)), ["- a\n- b\n", 5]);
});

test("옮긴 뒤 안긴 리스트는 1부터다: 앞에 서게 된 항목도, 뒤에 남은 항목도", () => {
  assert.deepEqual(after(indentListItem, at("1. a\n2. b\n    1. c\n", 6)), ["1. a\n    1. b\n        1. c\n", 10]);
  assert.deepEqual(after(outdentListItem, at("1. a\n    1. b\n    2. c\n2. d\n", 10)), ["1. a\n2. b\n    1. c\n3. d\n", 6]);
});

test("들여쓰기 단위는 블록이 이미 쓰는 것을 따른다: 두 칸 리스트는 두 칸으로", () => {
  assert.deepEqual(after(indentListItem, at("- a\n  - b\n- c\n", 11)), ["- a\n  - b\n  - c\n", 13]);
  assert.deepEqual(after(indentListItem, at("- a\n  - b\n  - c\n", 13)), ["- a\n  - b\n    - c\n", 15]);
});

test("첫 항목이 1이 아닌 리스트는 그 번호부터 잇는다", () => {
  assert.deepEqual(renumbered(at("3. a\n5. b\n", 5), 5), [{ from: 5, to: 6, insert: "4" }]);
});

test("자식이 있는 항목의 Enter는 그 자리에서 자르고, 번호는 다시 맞는다", () => {
  assert.deepEqual(after(listEnter, at("1. a\n    1. x\n2. b\n", 4)), ["1. a\n2. \n    1. x\n3. b\n", 8]);
});

test("마커가 없는 이어지는 줄의 Enter는 그 줄의 들여쓰기로 잇는다", () => {
  assert.deepEqual(after(listEnter, at("- a\n  more", 10)), ["- a\n  more\n  ", 13]);
});

test("빈 항목을 지우면 뒤의 번호가 당겨진다", () => {
  assert.deepEqual(after(listEnter, at("1. a\n2. \n3. c", 8)), ["1. a\n\n2. c", 5]);
});
