import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";

import { indentListItem, listLines, outdentListItem, renumbered } from "../web/src/features/listIndent.ts";

const parsed = (doc) => {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  // The whole tree, or the test is not one: a partial parse under load would only look like a wrong answer.
  assert.ok(ensureSyntaxTree(s, s.doc.length, 5000), "parsed whole");
  return s;
};
/** Each decoration as [line, style] for a line, or [prefix text] for the marker's box. */
const drawn = (s, from = 0, to = s.doc.length) => {
  const out = [];
  const it = listLines(s, from, to).iter();
  for (; it.value; it.next()) {
    if (it.value.spec.class?.startsWith("cm-list-line")) out.push([s.doc.lineAt(it.from).number, it.value.spec.attributes.style + (it.value.spec.class.includes("marker") ? " marker" : "")]);
    else out.push([s.doc.sliceString(it.from, it.to)]);
  }
  return out;
};

test("항목 줄은 단계만큼의 들여쓰기를 받고 마커 줄로 표시되며, 마커는 상자에 들어간다", () => {
  assert.deepEqual(drawn(parsed("- a\n- b\n")), [
    [1, "--list-indent:1.5em marker"], ["- "],
    [2, "--list-indent:1.5em marker"], ["- "],
  ]);
});

test("안긴 항목은 한 단계 더 밀리고, 들여쓴 공백은 마커의 상자에 든다", () => {
  assert.deepEqual(drawn(parsed("- a\n  - b\n")), [
    [1, "--list-indent:1.5em marker"], ["- "],
    [2, "--list-indent:3em marker"], ["  - "],
  ]);
});

test("마커가 없는 이어지는 줄은 밀리기만 한다", () => {
  assert.deepEqual(drawn(parsed("- a\n  more\n")), [
    [1, "--list-indent:1.5em marker"], ["- "],
    [2, "--list-indent:1.5em"],
  ]);
});

test("번호와 인용 속 항목도 같다", () => {
  assert.deepEqual(drawn(parsed("10. x\n\n> - q\n")), [
    [1, "--list-indent:1.5em marker"], ["10. "],
    [3, "--list-indent:1.5em marker"], ["> - "],
  ]);
});

test("할 일 항목의 상자는 체크 표시까지다", () => {
  assert.deepEqual(drawn(parsed("- [ ] a\n")), [[1, "--list-indent:1.5em marker"], ["- [ ] "]]);
});

test("리스트가 아닌 줄과 범위 밖은 손대지 않는다", () => {
  assert.deepEqual(drawn(parsed("text\n\n- a\n")), [[3, "--list-indent:1.5em marker"], ["- "]]);
  assert.deepEqual(drawn(parsed("- a\n- b\n"), 0, 3), [[1, "--list-indent:1.5em marker"], ["- "]]);
});

/** A state with the cursor at `cursor`, the whole tree parsed, four-space indent as the editor has it. */
const at = (doc, cursor) => {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage }), indentUnit.of("    ")] });
  assert.ok(ensureSyntaxTree(s, s.doc.length, 5000), "parsed whole");
  return s;
};
/** The doc after `command` on a view that holds `state`. */
const after = (command, state) => {
  let out = state.doc.toString();
  command({ state, dispatch: (tr) => (out = state.update(tr).state.doc.toString()) });
  return out;
};

test("Tab은 항목을 한 단계 안기고, 안긴 항목은 1부터, 남은 항목들은 이어서 번호가 매겨진다", () => {
  assert.equal(after(indentListItem, at("1. a\n2. b\n3. c\n", 6)), "1. a\n    1. b\n2. c\n");
});

test("Shift-Tab은 항목을 한 단계 빼고, 합쳐진 리스트를 다시 매긴다", () => {
  assert.equal(after(outdentListItem, at("1. a\n    1. b\n2. c\n", 10)), "1. a\n2. b\n3. c\n");
});

test("불릿 항목도 안기고 빼지며, 번호는 건드릴 것이 없다", () => {
  assert.equal(after(indentListItem, at("- a\n- b\n", 5)), "- a\n    - b\n");
  assert.equal(after(outdentListItem, at("- a\n    - b\n", 9)), "- a\n- b\n");
});

test("리스트 밖에서는 손대지 않고 넘긴다", () => {
  let dispatched = false;
  assert.equal(indentListItem({ state: at("text\n", 2), dispatch: () => (dispatched = true) }), false);
  assert.equal(dispatched, false);
});

test("첫 항목이 1이 아닌 리스트는 그 번호부터 잇는다", () => {
  assert.deepEqual(renumbered(at("3. a\n5. b\n", 5), 5), [{ from: 5, to: 6, insert: "4" }]);
});
