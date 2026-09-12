import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";

import { noteSyntax } from "../syntax.ts";
import { hidden } from "../web/src/features/livePreview.ts";

const state = (doc, cursor = doc.length) =>
	EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage, extensions: [noteSyntax] })] });

/** What `hidden` hides, as the text of each range. */
const gone = (s) => {
  const out = [];
  const it = hidden(s, 0, s.doc.length).iter();
  for (; it.value; it.next()) out.push(s.doc.sliceString(it.from, it.to));
  return out;
};

test("커서가 없는 헤딩은 #과 그 뒤 공백을 숨긴다", () => {
  assert.deepEqual(gone(state("## Hi\n\ntext")), ["## "]);
});

test("커서가 닿은 헤딩은 그대로 보인다", () => {
  assert.deepEqual(gone(state("## Hi\n\ntext", 3)), []);
  assert.deepEqual(gone(state("## Hi\n\ntext", 0)), [], "at the start counts as touching");
  assert.deepEqual(gone(state("## Hi\n\ntext", 5)), [], "at the end too");
});

test("강조는 별표를 숨기고 글은 남긴다", () => {
  assert.deepEqual(gone(state("*a* and **b**\n")), ["*", "*", "**", "**"]);
});

test("커서가 강조 안에 있으면 그 강조만 드러난다", () => {
  assert.deepEqual(gone(state("*a* and **b**\n", 2)), ["**", "**"]);
});

test("선택 영역이 걸친 노드는 모두 드러난다", () => {
  const s = EditorState.create({
    doc: "*a* and **b**\n",
    selection: EditorSelection.range(1, 10),
    extensions: [markdown({ base: markdownLanguage, extensions: [noteSyntax] })],
  });
  assert.deepEqual(gone(s), []);
});

test("마크다운 링크는 글만 남긴다", () => {
  assert.deepEqual(gone(state("[text](http://x.y)\n")), ["[", "]", "(", "http://x.y", ")"]);
});

test("위키링크는 괄호를 숨기고, 별칭이 있으면 대상도 숨긴다", () => {
  assert.deepEqual(gone(state("[[note]] [[note|shown]]\n")), ["[[", "]]", "[[", "note", "|", "]]"]);
});

test("취소선과 인라인 코드도 표시를 숨기고, 이스케이프는 백슬래시를 숨긴다", () => {
  assert.deepEqual(gone(state("~~a~~ `b` \\* c\n")), ["~~", "~~", "`", "`", "\\"]);
  assert.deepEqual(gone(state("~~a~~ `b` \\* c\n", 3)), ["`", "`", "\\"]);
});

test("Setext 헤딩의 밑줄은 표시다", () => {
  assert.deepEqual(gone(state("Title\n=====\n\ntext")), ["====="]);
  assert.deepEqual(gone(state("Title\n=====\n\ntext", 2)), []);
});

test("==강조==는 양끝의 표시를 숨긴다", () => {
  assert.deepEqual(gone(state("a ==hi== b\n")), ["==", "=="]);
  assert.deepEqual(gone(state("a ==hi== b\n", 4)), []);
});

test("%%주석%%은 양끝의 표시를 숨긴다", () => {
  assert.deepEqual(gone(state("a %%hi%% b\n")), ["%%", "%%"]);
});

test("범위 밖은 보지 않는다", () => {
  const s = state("# a\n\n# b\n");
  const it = hidden(s, 0, 3).iter();
  const out = [];
  for (; it.value; it.next()) out.push(it.from);
  assert.deepEqual(out, [0]);
});

import { ensureSyntaxTree } from "@codemirror/language";
import { blocks, toggleTask } from "../web/src/features/livePreview.ts";

const parsed = (doc, cursor) => {
  const s = state(doc, cursor);
  // The whole tree, or the test is not one: a partial parse under load would only look like a wrong answer.
  assert.ok(ensureSyntaxTree(s, s.doc.length, 5000), "parsed whole");
  return s;
};
/** Each block decoration as [line number or text, kind]. */
const drawn = (s) => {
  const out = [];
  const it = blocks(s).deco.iter();
  for (; it.value; it.next()) {
    const d = it.value;
    if (d.spec.class) out.push([s.doc.lineAt(it.from).number, d.spec.class]);
    else if (d.spec.widget) out.push([s.doc.sliceString(it.from, it.to), d.spec.widget.constructor.name]);
    else out.push([s.doc.sliceString(it.from, it.to), "hidden"]);
  }
  return out;
};

test("펜스 코드는 요소 하나에 언어가 붙고, 줄마다 코드 급이며, 커서가 없으면 펜스 줄이 사라진다", () => {
  const s = parsed("a\n\n```js\nx\n```\n", 0);
  assert.deepEqual(wrapped(s), [[3, 14, "cm-code", 50]], "to the node's end; the default rank");
  // A block replace sorts before the line decoration at the same position.
  assert.deepEqual(drawn(s), [["```js", "hidden"], [3, "cm-code-line"], [4, "cm-code-line"], ["```", "hidden"], [5, "cm-code-line"]]);
  assert.deepEqual(drawn(parsed("a\n\n```js\nx\n```\n", 9)), [[3, "cm-code-line"], [4, "cm-code-line"], [5, "cm-code-line"]], "on any of its lines both fences show");
});

test("닫히지 않은 펜스는 여는 줄만 사라진다", () => {
  assert.deepEqual(drawn(parsed("before\n\n```\nx\ny\n", 0)).filter(([, k]) => k === "hidden"), [["```", "hidden"]]);
});

/** Each block wrapper as [from, to, class, rank]. */
const wrapped = (s) => {
  const out = [];
  const it = blocks(s).wrappers.iter();
  for (; it.value; it.next()) out.push([it.from, it.to, it.value.attributes.class, it.value.rank]);
  return out;
};

test("인용은 줄들을 감싸는 요소 하나이고, 커서가 없으면 >가 숨는다", () => {
  assert.deepEqual(wrapped(parsed("> a\n> b\n\nc")), [[0, 7, "cm-quote", 100]]);
  assert.deepEqual(drawn(parsed("> a\n> b\n\nc")), [["> ", "hidden"], ["> ", "hidden"]]);
  assert.deepEqual(drawn(parsed("> a\n> b\n\nc", 5)), [], "cursor on any of its lines shows every >");
});

test("인용 속 인용은 요소 속 요소이고, 안쪽이 낮은 rank라 안에 놓인다", () => {
  assert.deepEqual(wrapped(parsed("> a\n> > b\n> c\n")), [[0, 13, "cm-quote", 100], [4, 13, "cm-quote", 99]]);
  assert.deepEqual(drawn(parsed("> a\n> > b\n> c\n")).map(([t]) => t), ["> ", "> ", "> ", "> "], "every mark hides, each by its own quote");
});

test("인용 속 코드 블록의 줄은 여전히 코드 줄이다", () => {
  assert.deepEqual(drawn(parsed("> ```\n> x\n> ```\n")).filter(([, k]) => k === "cm-code-line").length, 3);
});

test("[!type]으로 여는 인용은 콜아웃이다: 줄마다 종류가 붙고, 첫 줄은 제목이며, 표시는 커서가 없을 때 숨는다", () => {
  assert.deepEqual(wrapped(parsed("> [!Note] Title\n> body\n\nafter", 24)), [[0, 22, "cm-quote cm-callout", 100]]);
  const off = drawn(parsed("> [!Note] Title\n> body\n\nafter", 24));
  assert.deepEqual(off, [[1, "cm-callout-title"], ["> ", "hidden"], ["[!Note] ", "hidden"], ["> ", "hidden"]]);
  const on = drawn(parsed("> [!Note] Title\n> body\n\nafter", 3));
  assert.deepEqual(on.filter(([, k]) => k === "hidden"), [], "on the callout, every mark shows");
  assert.deepEqual(gone(state("> [!Note] Title\n\nafter")), [], "the inline half leaves the marker's brackets to the block half");
});

test("종류 뒤의 +와 -도 표시의 일부다", () => {
  assert.deepEqual(drawn(parsed("> [!tip]- t\n\nx", 14)).filter(([, k]) => k === "hidden"), [["> ", "hidden"], ["[!tip]- ", "hidden"]]);
});

test("구분선은 커서가 그 줄에 없을 때만 선으로 그려진다", () => {
  assert.deepEqual(drawn(parsed("a\n\n---\n\nb")), [["---", "Rule"]]);
  assert.deepEqual(drawn(parsed("a\n\n---\n\nb", 3)), []);
});

test("할 일 표시는 커서가 없는 줄에서 상자가 되고, 그 상자는 건너뛰는 범위다; 끝난 할 일은 커서와 상관없이 그렇게 읽힌다", () => {
  const s = parsed("- [ ] a\n- [x] b\n", 0);
  assert.deepEqual(drawn(s), [[2, "cm-task-done"], ["- ", "hidden"], ["[x] ", "Checkbox"]], "on a task item the bullet goes, the box being the marker");
  assert.deepEqual(drawn(parsed("- [x] b\n", 7)), [[1, "cm-task-done"]], "on the line, the box is text again but the line stays done");
  const atoms = [];
  const it = blocks(s).atoms.iter();
  for (; it.value; it.next()) atoms.push([it.from, it.to]);
  assert.deepEqual(atoms, [[8, 10], [10, 14]]);
});

test("불릿은 커서가 없는 줄에서 점이 되고, 그 줄에 오면 글자다; 번호는 그대로다", () => {
  assert.deepEqual(drawn(parsed("- a\n* b\n1. c\n", 0)), [["* ", "Bullet"]]);
  assert.deepEqual(drawn(parsed("- a\n* b\n1. c\n", 9)), [["- ", "Bullet"], ["* ", "Bullet"]]);
  const atoms = [];
  const it = blocks(parsed("- a\n", 3)).atoms.iter();
  for (; it.value; it.next()) atoms.push([it.from, it.to]);
  assert.deepEqual(atoms, [], "cursor on the line: the marker is text, nothing to step over");
});

test("리스트 줄의 앞 공백은 커서가 없는 줄에서 숨고, 코드 펜스 안과 커서 줄에서는 남는다", () => {
  const doc = "- a\n  more\n    - b\n\n    ```\n    code\n    ```\n";
  const off = drawn(parsed(doc, 0)).filter(([, k]) => k === "hidden").map(([t]) => t);
  assert.deepEqual(off, ["  ", "    ", "    ```", "    ```"], "the continuation line's and the nested item's indentation, and the fences by the code chrome; the code's own spaces are not touched");
  const on = drawn(parsed(doc, 6)).filter(([, k]) => k === "hidden").map(([t]) => t);
  assert.deepEqual(on, ["    ", "    ```", "    ```"], "on the continuation line its spaces show; the nested item's still hide");
});

test("Mod-Enter는 커서 줄의 할 일을 켜고 끈다, 없으면 손대지 않는다", () => {
  const run = (doc, cursor) => {
    let out = null;
    const handled = toggleTask({ state: parsed(doc, cursor), dispatch: (tr) => (out = tr.changes) });
    return { handled, out };
  };
  assert.deepEqual(run("- [ ] a\n", 7), { handled: true, out: [{ from: 2, to: 5, insert: "[x]" }] });
  assert.deepEqual(run("- [X] a\n", 7), { handled: true, out: [{ from: 2, to: 5, insert: "[ ]" }] });
  assert.deepEqual(run("- a\n", 3), { handled: false, out: null });
});
