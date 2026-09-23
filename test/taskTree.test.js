import assert from "node:assert/strict";
import test from "node:test";

import { progressUnder, standingOf, treeOf } from "../web/src/taskTree.ts";

/** The form our agent is told to write (spec.ts TASKS_FORM), filled in, with a heading between groups. */
const PLAN = `# Tasks

A login for the app, as the requirements say.

- [x] 1. Add the login form
  - web/src/components/Login.tsx, a form of two fields
  - _Requirements: 1.1, 1.2_
  - _Done when: \`npm test -- login\` passes_

## Sessions

- [ ] 2. Keep the session
- [x] 2.1 Issue a token
  - _Requirements: 2.1_
  - _Done when: the cookie is set after signing in_
- [ ] 2.2 Renew it
  - server.ts: renew on every request
    that carries one
  - _Requirements: 2.2_

- [ ] 3. Wire it together
`;

test("머리말은 첫 작업 전까지 통째로, 작업은 번호로, 사이의 제목은 섹션으로", () => {
  const tree = treeOf(PLAN);
  assert.equal(tree.head, "# Tasks\n\nA login for the app, as the requirements say.");
  assert.deepEqual(
    tree.rows.map((row) => (row.kind === "task" ? `${row.number}` : `# ${row.text}`)),
    ["1", "# Sessions", "2", "2.1", "2.2", "3"],
  );
  assert.deepEqual(tree.tasks.map((task) => [task.number, task.done]), [["1", true], ["2", false], ["2.1", true], ["2.2", false], ["3", false]]);
});

test("작업 아래 글머리는 셋으로 갈린다: 요구사항, 끝남의 기준, 나머지", () => {
  const [one, , two, twoOne, twoTwo] = treeOf(PLAN).rows;
  assert.deepEqual(one.involves, ["web/src/components/Login.tsx, a form of two fields"]);
  assert.deepEqual(one.requirements, ["1.1", "1.2"]);
  assert.equal(one.doneWhen, "`npm test -- login` passes");
  assert.deepEqual([two.involves, two.requirements, two.doneWhen], [[], [], null], "a heading has nothing of its own");
  assert.equal(twoOne.doneWhen, "the cookie is set after signing in", "what to look at is a criterion too");
  // A bullet wrapped onto a second line is one bullet.
  assert.deepEqual(twoTwo.involves, ["server.ts: renew on every request that carries one"]);
});

test("깊이와 자식은 번호가 말한다", () => {
  const rows = treeOf(PLAN).rows.filter((row) => row.kind === "task");
  assert.deepEqual(rows.map((row) => [row.number, row.depth, row.children]), [
    ["1", 0, []],
    ["2", 0, ["2.1", "2.2"]],
    ["2.1", 1, []],
    ["2.2", 1, []],
    ["3", 0, []],
  ]);
});

test("형식을 벗어난 줄은 작업으로 짐작하지 않고 줄로 보인다", () => {
  const tree = treeOf("- [ ] 1. First\n- [ ] Second without a number\n- [ ] 2. Third\n");
  assert.deepEqual(tree.rows.map((row) => row.kind === "task" ? row.number : row.text), ["1", "Second without a number", "2"]);
  // A bullet under a task with no number is not that task's bullet — the line is its own.
  assert.deepEqual(tree.rows[0].involves, ["Second without a number"].slice(0, 0));
});

test("CR은 줄의 끝이지 줄이 아니다", () => {
  const tree = treeOf("# Plan\r\n\r\n- [ ] 1. One\r\n  - _Requirements: 1.1_\r\n");
  assert.equal(tree.head, "# Plan");
  assert.deepEqual(tree.rows[0].requirements, ["1.1"]);
});

test("서 있는 자리: 도는 것이 먼저, 끝난 것, 나머지 — 다음 것은 자리가 아니다", () => {
  assert.equal(standingOf({ number: "2.1", done: false, cancelled: false }, { running: "2.1" }), "running");
  assert.equal(standingOf({ number: "2", done: false, cancelled: false }, { running: "2.1" }), "running", "a heading runs by way of its sub-task");
  assert.equal(standingOf({ number: "1", done: true, cancelled: false }, { running: "2.1" }), "done");
  assert.equal(standingOf({ number: "2.2", done: false, cancelled: false }, { running: null }), "todo", "the first open one is to do like the rest");
  assert.equal(standingOf({ number: "3", done: false, cancelled: false }, { running: null }), "todo");
  assert.equal(standingOf({ number: "21", done: false, cancelled: false }, { running: "2.1" }), "todo", "21 is not 2's sub-task");
});

test("부모의 진행은 자식 칸의 수다", () => {
  const { tasks } = treeOf(PLAN);
  assert.deepEqual(progressUnder(tasks, "2"), { done: 1, total: 2 });
  assert.deepEqual(progressUnder(tasks, "1"), { done: 0, total: 0 });
});

test("행마다 자기 줄 번호를 안다 — 편집기가 세는 대로, 1부터", () => {
  const rows = treeOf(PLAN).rows;
  assert.deepEqual(rows.map((row) => [row.kind === "task" ? row.number : row.text, row.line]), [
    ["1", 5],
    ["Sessions", 10],
    ["2", 12],
    ["2.1", 13],
    ["2.2", 16],
    ["3", 21],
  ]);
  const one = rows[0];
  assert.deepEqual([one.requirementsLine, one.doneWhenLine], [7, 8]);
  assert.deepEqual([rows[2].requirementsLine, rows[2].doneWhenLine], [null, null], "a heading has neither");
});

test("접어 둔 것과 검토 중인 것: 접어 둔 것은 도는 것 다음이고, 검토 중은 끝난 것 다음, 다음 것 앞이다", () => {
  assert.equal(standingOf({ number: "1", done: false, cancelled: true }, { running: null }), "cancelled");
  assert.equal(standingOf({ number: "1", done: false, cancelled: true }, { running: "1" }), "running", "돌고 있으면 도는 것");
  assert.equal(standingOf({ number: "1", done: false, cancelled: false }, { running: null, next: "2", reviewed: new Set(["1"]) }), "review");
  assert.equal(standingOf({ number: "1", done: true, cancelled: false }, { running: null, next: null, reviewed: new Set(["1"]) }), "done", "받아들여졌으면 끝난 것");
  const { tasks } = treeOf(PLAN.replace("- [ ] 2.2", "- [-] 2.2"));
  assert.deepEqual(progressUnder(tasks, "2"), { done: 1, total: 1 }, "접어 둔 하위는 세지 않는다");
});
