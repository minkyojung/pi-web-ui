import assert from "node:assert/strict";
import test from "node:test";

import { checkMark, commitTabTitle, footWords, headWords, listOf, taskOfCommit, taskTabTitle } from "../web/src/resultsList.ts";

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

test("버튼의 말 — 도는 것, 아니면 내 차례인 것, 아니면 어디까지 왔는지", () => {
  const at = (done, review, cancelled = 0, total = 5) => ({ total, done, cancelled, next: null, review });
  assert.deepEqual(footWords(at(1, ["2"]), { fresh: 0, running: "3" }, { tasks: 2 }), { text: "3 running", strong: null }, "도는 동안은 그것뿐");
  assert.deepEqual(footWords(at(1, ["2"]), { fresh: 1, running: null }, { tasks: 2 }), { text: "1 in review · 3 to do", strong: "1 in review" }, "안 본 것이 있으면 검토가 진하게");
  assert.deepEqual(footWords(at(1, ["2"]), { fresh: 0, running: null }, { tasks: 2 }), { text: "1 in review · 3 to do", strong: null }, "봤으면 흐리게");
  assert.deepEqual(footWords(at(3, ["2", "4"]), { fresh: 0, running: null }, { tasks: 5 }), { text: "2 in review", strong: null }, "남은 할 일이 없으면 검토만");
  assert.deepEqual(footWords(at(2, [], 1), { fresh: 0, running: null }, { tasks: 2 }), { text: "2 of 4 done", strong: null }, "접어 둔 것은 전체에서 뺀다");
  assert.deepEqual(footWords(at(4, [], 1), { fresh: 0, running: null }, { tasks: 4 }), { text: "4 done", strong: null }, "끝");
  assert.deepEqual(footWords(null, { fresh: 0, running: null }, { tasks: 1 }), { text: "1 task", strong: null }, "tasks.md가 없으면 결과의 수");
  assert.equal(headWords(at(1, ["2"], 1), null), "1 done · 1 in review · 1 set aside · 2 to do");
  assert.equal(headWords(at(1, [], 0), "3"), "1 done · 1 running · 3 to do");
  assert.equal(headWords(at(5, [], 0), null), "5 done · 0 to do");
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
  // A task's tab: the run in review names it first, then the last result; a task with neither is its number.
  const withReview = specs.map((spec) => ({ ...spec, review: spec.name === "greeting" ? [{ spec: "greeting", task: "3", title: "Ship it", then: [], session: "s", at: 1 }] : [] }));
  assert.equal(taskTabTitle(withReview, "greeting", "3"), "Task 3 · Ship it", "심사 중인 실행의 줄");
  assert.equal(taskTabTitle(withReview, "greeting", "2"), "Task 2 · Test the greeting", "받아들인 결과의 줄");
  assert.equal(taskTabTitle(withReview, "greeting", "9"), "Task 9", "아직 아무것도 없으면 번호");
  assert.equal(taskTabTitle(null, "greeting", "1"), "Task 1");
});

test("검사의 표: 앱이 돌린 것이 에이전트의 말을 이긴다", () => {
  assert.equal(checkMark({ checks: null, verified: [] }), "none");
  assert.equal(checkMark({ checks: "npm test — 2 passed", verified: [] }), "said");
  assert.equal(checkMark({ checks: "npm test — 2 passed", verified: [{ name: "npm test", exit: 0 }] }), "passed");
  assert.equal(checkMark({ checks: null, verified: [{ name: "npm test", exit: 0 }, { name: "npm run lint", exit: 1 }] }), "failed", "one failure fails the mark");
});
