import assert from "node:assert/strict";
import test from "node:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { noteSyntax } from "../syntax.ts";
import { plan } from "../web/src/features/taskPlan.ts";
import { running } from "../web/src/features/taskStart.ts";

const PLAN = `# Tasks

- [x] 1. First
  - web/a.ts
  - _Requirements: 1.1_
  - _Done when: \`npm test\` passes_
- [ ] 2. Heading
- [x] 2.1 Second
- [ ] 2.2 Third
- [ ] 3. Fourth
`;

const state = (doc, now = null) =>
  EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [noteSyntax] }), running.of(now)] });

/** What is drawn, by line: line classes as words, a widget as its text. */
const drawn = (s) => {
  const out = [];
  for (const it = plan(s).iter(); it.value; it.next()) {
    const line = s.doc.lineAt(it.from).number;
    const d = it.value;
    if (d.spec.class) out.push([line, d.spec.class]);
    else if (d.spec.widget) out.push([line, `${d.spec.widget.done} / ${d.spec.widget.total}`]);
  }
  return out;
};

test("작업 줄은 서 있는 자리를 입고, 부모는 자식의 수를, 두 키 줄은 물러난다", () => {
  assert.deepEqual(drawn(state(PLAN)), [
    [3, "cm-plan-task cm-standing-done"],
    [5, "cm-plan-key"],
    [6, "cm-plan-key"],
    [7, "cm-plan-task cm-standing-todo"],
    [7, "1 / 2"],
    [8, "cm-plan-task cm-standing-done"],
    [9, "cm-plan-task cm-standing-next"],
    [10, "cm-plan-task cm-standing-todo"],
  ]);
});

test("세션이 돌리는 작업은 돌고 있다 — 그 부모도", () => {
  const rows = drawn(state(PLAN, "2.2")).filter(([, what]) => what.startsWith("cm-plan-task"));
  assert.deepEqual(rows.map(([line, what]) => [line, what.replace("cm-plan-task cm-standing-", "")]), [
    [3, "done"],
    [7, "running"],
    [8, "done"],
    [9, "running"],
    [10, "todo"],
  ]);
});

test("작업이 없는 문서에는 아무것도 그리지 않는다", () => {
  assert.deepEqual(drawn(state("# Tasks\n\nNothing yet.\n")), []);
});
