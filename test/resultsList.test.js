import assert from "node:assert/strict";
import test from "node:test";

import { commitTabTitle, freshWords, listOf, taskOfCommit, tasksWords } from "../web/src/resultsList.ts";

const run = (task, commit, over = {}) => ({ task, commit, short: commit.slice(0, 7), title: `Task ${task}`, at: 0, checks: null, files: [], added: 1, deleted: 0, ...over });
const RESULTS = [run("1", "aaaaaaa1"), run("2", "bbbbbbb2", { added: 8 }), run("3", "ccccccc3", { added: 41, deleted: 2 })];

test("작업마다 한 줄, 한 순서대로 — 합계와 제일 새 커밋", () => {
  const list = listOf(RESULTS, null);
  assert.deepEqual(list.lines.map((line) => [line.task, line.runs]), [["1", 1], ["2", 1], ["3", 1]]);
  assert.deepEqual([list.tasks, list.added, list.deleted, list.newest], [3, 50, 2, "ccccccc3"]);
  assert.deepEqual(listOf([], null), { lines: [], tasks: 0, fresh: 0, added: 0, deleted: 0, newest: null });
});

test("마지막으로 본 커밋 뒤의 것이 새것이다 — 본 적이 없으면 전부", () => {
  assert.deepEqual(listOf(RESULTS, null).lines.map((line) => line.fresh), [true, true, true]);
  assert.deepEqual(listOf(RESULTS, "aaaaaaa1").lines.map((line) => line.fresh), [false, true, true]);
  assert.equal(listOf(RESULTS, "aaaaaaa1").fresh, 2);
  assert.equal(listOf(RESULTS, "ccccccc3").fresh, 0, "끝까지 봤다");
});

test("본 커밋이 목록에 없으면 아무것도 본 게 아니다 — 브랜치가 바뀌었거나 역사가 다시 쓰였다", () => {
  assert.equal(listOf(RESULTS, "deadbeef").fresh, 3, "틀려도 안전한 쪽으로");
});

test("다시 돌린 작업은 마지막 것이 한 줄로, 몇 번인지와 함께 — 자리도 다시 돌린 때로", () => {
  const again = [...RESULTS, run("1", "ddddddd4", { added: 5, checks: "npm test — 2 passed" })];
  const list = listOf(again, "ccccccc3");
  assert.deepEqual(list.lines.map((line) => [line.task, line.runs, line.commit, line.fresh]), [
    ["2", 1, "bbbbbbb2", false],
    ["3", 1, "ccccccc3", false],
    ["1", 2, "ddddddd4", true],
  ]);
  assert.equal(list.added, 8 + 41 + 5, "합계는 남은 줄들의 것 — 덮인 실행은 세지 않는다");
  assert.equal(list.tasks, 3);
});

test("버튼의 말", () => {
  assert.equal(tasksWords({ tasks: 1 }), "1 task");
  assert.equal(tasksWords({ tasks: 5 }), "5 tasks");
  assert.equal(freshWords({ fresh: 0 }), null, "새것이 없으면 조용하다");
  assert.equal(freshWords({ fresh: 2 }), "2 new");
});

test("커밋이 어느 작업의 것인지는 이미 받은 결과에서 찾는다 — 짧은 해시로도, 없으면 null", () => {
  const specs = [
    { name: "greeting", results: [run("1", "aaaaaaa1111"), run("2", "bbbbbbb2222", { title: "Test the greeting" })] },
    { name: "email-auth", results: [run("1", "ccccccc3333", { title: "Add sign-in" })] },
  ];
  assert.deepEqual(taskOfCommit(specs, "bbbbbbb2222"), { spec: "greeting", task: "2", title: "Test the greeting", short: "bbbbbbb" });
  assert.equal(taskOfCommit(specs, "ccccccc").spec, "email-auth", "주소는 짧은 해시일 수도 있다");
  assert.equal(taskOfCommit(specs, "deadbee"), null, "작업의 커밋이 아니다");
  assert.equal(taskOfCommit(null, "aaaaaaa"), null, "결과가 아직 안 왔다");
  assert.equal(commitTabTitle({ task: "2", title: "Test the greeting" }), "Task 2 · Test the greeting");
});
