import assert from "node:assert/strict";
import { blankBoxes } from "../specTasks.ts";
import test from "node:test";

import { doneWhenOf, nextTask, parseTasks, progressOf, runsOf, runsUnder, taskToRun, withBox, withDone, withParents } from "../specTasks.ts";

/** Kiro's own example, from its spec prompt — the form our agent is told to write. */
const KIRO = `# Implementation Plan

- [ ] 1. Set up project structure and core interfaces
  - Create directory structure for models, services, repositories, and API components
  - Define interfaces that establish system boundaries
  - _Requirements: 1.1_

- [ ] 2. Implement data models and validation
- [ ] 2.1 Create core data model interfaces and types
  - Write TypeScript interfaces for all data models
  - Implement validation functions for data integrity
  - _Requirements: 2.1, 3.3, 1.2_

- [ ] 2.2 Implement User model with validation
  - Write User class with validation methods
  - Create unit tests for User model validation
  - _Requirements: 1.2_
`;

const numbers = (text) => parseTasks(text).map((task) => task.number);

test("작업은 번호가 붙은 칸이고, 하위 글머리와 _Requirements_는 작업이 아니다", () => {
  assert.deepEqual(parseTasks(KIRO), [
    { number: "1", title: "Set up project structure and core interfaces", done: false, cancelled: false },
    { number: "2", title: "Implement data models and validation", done: false, cancelled: false },
    { number: "2.1", title: "Create core data model interfaces and types", done: false, cancelled: false },
    { number: "2.2", title: "Implement User model with validation", done: false, cancelled: false },
  ]);
});

test("들여쓰기는 아무것도 결정하지 않는다 — 번호가 결정한다", () => {
  // Kiro's own example leaves 2.1 flush with 2; a model that indents it means the same.
  const indented = KIRO.replace("- [ ] 2.1", "  - [ ] 2.1").replace("- [ ] 2.2", "    - [ ] 2.2");
  assert.deepEqual(parseTasks(indented), parseTasks(KIRO), "같은 작업들");
});

test("번호는 열을 넘어간다", () => {
  const many = "- [ ] 9. Nine\n- [ ] 10. Ten\n- [ ] 10.1 Ten point one\n- [ ] 11. Eleven\n";
  assert.deepEqual(numbers(many), ["9", "10", "10.1", "11"]);
});

test("끝난 칸은 [x]와 [X] 둘 다, 마침표는 있어도 없어도 된다", () => {
  const text = "- [x] 1. Lower\n- [X] 2 Upper, no dot\n- [ ] 3. Open\n";
  assert.deepEqual(parseTasks(text), [
    { number: "1", title: "Lower", done: true, cancelled: false },
    { number: "2", title: "Upper, no dot", done: true, cancelled: false },
    { number: "3", title: "Open", done: false, cancelled: false },
  ]);
});

test("작업의 모양이 아닌 줄은 조용히 무시한다 — 우리 에이전트가 쓴 파일만 읽으면 된다", () => {
  const text = [
    "# Implementation Plan",
    "- [ ] Set up the thing", // no number
    "* [ ] 1. Starred",
    "- [] 2. No space in the box",
    "- [ ] 3.1.1 Three levels deep",
    "  - _Requirements: 1.1_",
    "- [ ] 4. Real",
  ].join("\n");
  assert.deepEqual(numbers(text), ["4"]);
});

// --- which one is next ---

test("다음 작업은 안 끝난 첫 번째, 그리고 하위가 있는 상위는 건너뛴다 — 할 일은 하위에 있다", () => {
  const tasks = parseTasks(KIRO);
  assert.equal(nextTask(tasks).number, "1");
  assert.equal(nextTask(parseTasks(withDone(KIRO, new Set(["1"])))).number, "2.1", "2는 2.1과 2.2의 묶음일 뿐이다");
  assert.equal(nextTask(parseTasks(withDone(KIRO, new Set(["1", "2.1"])))).number, "2.2");
});

test("전부 끝나면 다음은 없다 — 묶음뿐인 상위가 열려 있어도", () => {
  const done = withDone(KIRO, new Set(["1", "2.1", "2.2"]));
  assert.equal(nextTask(parseTasks(done)), null);
});

test("번호로 고르면 그 작업, 묶음을 고르면 그 하위 중 남은 첫 번째", () => {
  const tasks = parseTasks(KIRO);
  assert.equal(taskToRun(tasks, "2.2").title, "Implement User model with validation");
  assert.equal(taskToRun(tasks, "2").number, "2.1", "묶음은 일이 아니다 — 하위부터");
  assert.equal(taskToRun(parseTasks(withDone(KIRO, new Set(["2.1"]))), "2").number, "2.2");
  assert.equal(taskToRun(parseTasks(withDone(KIRO, new Set(["2.1", "2.2"]))), "2").number, "2", "하위가 다 끝났으면 묶음 그대로 — 이미 끝났다고 말할 수 있게");
  assert.equal(taskToRun(tasks, "3"), null);
});

// --- writing the boxes back ---

test("칸만 고친다 — 나머지는 한 바이트도 그대로", () => {
  const after = withDone(KIRO, new Set(["1", "2.2"]));
  assert.equal(after, KIRO.replace("- [ ] 1.", "- [x] 1.").replace("- [ ] 2.2", "- [x] 2.2"));
  assert.deepEqual(parseTasks(after).filter((task) => task.done).map((task) => task.number), ["1", "2.2"]);
});

test("칸에 없는 것은 비운다 — 모델이 체크한 남의 칸은 여기서 무효가 된다", () => {
  const meddled = KIRO.replace("- [ ] 2.1", "- [x] 2.1").replace("- [ ] 2.2", "- [x] 2.2");
  assert.equal(withDone(meddled, new Set(["2.1"])), KIRO.replace("- [ ] 2.1", "- [x] 2.1"));
});

test("하위가 전부 끝나면 상위도 끝난 것이다", () => {
  const tasks = parseTasks(KIRO);
  assert.deepEqual(withParents(tasks, new Set(["1"])), new Set(["1"]));
  assert.deepEqual(withParents(tasks, new Set(["1", "2.1"])), new Set(["1", "2.1"]), "아직 2.2가 남았다");
  assert.deepEqual(withParents(tasks, new Set(["1", "2.1", "2.2"])), new Set(["1", "2.1", "2.2", "2"]));
});

test("진행은 보이는 칸을 전부 센다 — 묶음 상위의 칸도; 다음 작업은 잎에서", () => {
  assert.deepEqual(progressOf(parseTasks(KIRO)), { total: 4, done: 0, cancelled: 0, next: "1", review: [] }, "1, 2, 2.1, 2.2 — 화면의 칸 넷");
  const half = KIRO.replace("- [ ] 1.", "- [x] 1.").replace("- [ ] 2.1", "- [x] 2.1");
  assert.deepEqual(progressOf(parseTasks(half)), { total: 4, done: 2, cancelled: 0, next: "2.2", review: [] });
  const leaves = half.replace("- [ ] 2.2", "- [x] 2.2");
  assert.deepEqual(progressOf(parseTasks(leaves)), { total: 4, done: 3, cancelled: 0, next: null, review: [] }, "상위 2의 칸은 코드가 체크하기 전까지 열려 있고, 다음은 없다");
  const all = leaves.replace("- [ ] 2.", "- [x] 2.");
  assert.deepEqual(progressOf(parseTasks(all)), { total: 4, done: 4, cancelled: 0, next: null, review: [] });
  assert.deepEqual(progressOf([]), { total: 0, done: 0, cancelled: 0, next: null, review: [] });
});

test("번호 하나가 뜻하는 실행 — 잎은 그것, 묶음은 남은 하위 전부를 차례로, 없으면 null", () => {
  const tasks = parseTasks(KIRO);
  const numbers = (found) => found?.map((task) => task.number);
  assert.deepEqual(numbers(runsUnder(tasks, "1")), ["1"]);
  assert.deepEqual(numbers(runsUnder(tasks, "2")), ["2.1", "2.2"], "Kiro의 Start task on a heading: 하위부터, 전부");
  assert.deepEqual(numbers(runsUnder(parseTasks(withDone(KIRO, new Set(["2.1"]))), "2")), ["2.2"], "끝난 하위는 뺀다");
  assert.deepEqual(numbers(runsUnder(parseTasks(withDone(KIRO, new Set(["2.1", "2.2"]))), "2")), [], "남은 게 없으면 비어 있다");
  assert.deepEqual(numbers(runsUnder(parseTasks(withDone(KIRO, new Set(["1"]))), "1")), [], "끝난 잎도 비어 있다");
  assert.equal(runsUnder(tasks, "9"), null);
});

test("번호 여럿은 겹쳐도 한 번씩, 문서의 순서로", () => {
  const tasks = parseTasks(KIRO);
  const numbers = (given) => runsOf(tasks, given).runs.map((task) => task.number);
  assert.deepEqual(numbers(["2", "2.2"]), ["2.1", "2.2"], "2가 2.2를 품는다");
  assert.deepEqual(numbers(["2.2", "1"]), ["1", "2.2"], "준 순서가 아니라 문서의 순서");
  assert.deepEqual(numbers(["2.2", "2.2"]), ["2.2"]);
  assert.deepEqual(runsOf(tasks, ["1", "9", "2"]), { runs: [], missing: "9" }, "없는 번호가 있으면 아무것도 없고 그 번호를 말한다");
});

test("끝났다는 기준의 줄(_Done when:_)은 작업이 아니다 — 작업은 번호가 있는 줄뿐", () => {
  const plan = "# 구현 계획\n\n- [ ] 1. 인사 함수를 더한다\n  - greet.js\n  - _Requirements: 1.1_\n  - _Done when: `npm test -- greet` passes_\n\n- [ ] 2. 화면에 잇는다\n- [x] 2.1 버튼\n  - _Done when: 버튼을 누르면 인사가 보인다_\n";
  assert.deepEqual(
    parseTasks(plan).map((task) => `${task.number}${task.done ? "x" : ""}`),
    ["1", "2", "2.1x"],
  );
});

test("a task's _Done when:_ command is what is in its first backticks, on its own lines only; no backticks is no command", () => {
  const plan = "# Plan\n\n- [ ] 1. First\n  - greet.js\n  - _Done when: `npm test -- greet` passes and the file is there_\n- [ ] 2. Second\n  - _Done when: look at the page_\n- [ ] 3. Third\n- [ ] 3.1 Part\n  - _Requirements: 1.1_\n  - _Done when: `npm run typecheck`_\n";
  assert.equal(doneWhenOf(plan, "1"), "npm test -- greet");
  assert.equal(doneWhenOf(plan, "2"), null, "what to look at is for a person");
  assert.equal(doneWhenOf(plan, "3"), null, "the heading has none of its own — 3.1's is 3.1's");
  assert.equal(doneWhenOf(plan, "3.1"), "npm run typecheck");
  assert.equal(doneWhenOf(plan, "9"), null);
});

test("[-]는 사람이 접어 둔 작업: 다음 작업에서 건너뛰고, 진행에서는 따로 세고, 상위는 나머지가 끝나면 끝난다", () => {
  const aside = KIRO.replace("- [ ] 2.1", "- [-] 2.1");
  const tasks = parseTasks(aside);
  assert.deepEqual(tasks.find((t) => t.number === "2.1"), { number: "2.1", title: "Create core data model interfaces and types", done: false, cancelled: true });
  assert.equal(nextTask(tasks).number, "1");
  assert.equal(nextTask(tasks.filter((t) => t.number !== "1")).number, "2.2", "2.1은 건너뛴다");
  assert.deepEqual(progressOf(tasks), { total: 4, done: 0, cancelled: 1, next: "1", review: [] });
  assert.deepEqual(withParents(tasks, new Set(["2.2"])), new Set(["2.2", "2"]), "남은 하위가 끝나면 상위도");
  assert.deepEqual(withParents(parseTasks(aside.replace("- [ ] 2.2", "- [-] 2.2")), new Set([])), new Set([]), "전부 접어 둔 상위는 끝난 것이 아니다");
  assert.deepEqual(runsUnder(tasks, "2").map((t) => t.number), ["2.2"], "묶음을 돌리면 접어 둔 것은 빠진다");
  assert.deepEqual(runsUnder(tasks, "2.1").map((t) => t.number), ["2.1"], "이름을 대면 접어 둔 것도 다시 돈다");
});

test("검토 중인 작업 — 커밋은 있으나 사람이 받아들이지 않은 — 은 다음 작업이 아니고, 묶음 실행에서도 빠진다", () => {
  const tasks = parseTasks(KIRO);
  const reviewed = new Set(["1", "2.1"]);
  assert.equal(nextTask(tasks, reviewed).number, "2.2");
  assert.deepEqual(progressOf(tasks, reviewed).next, "2.2");
  assert.deepEqual(progressOf(tasks, reviewed).review, ["1", "2.1"], "run and not marked: in review, by number");
  assert.deepEqual(progressOf(parseTasks(KIRO.replace("- [ ] 2.1", "- [x] 2.1")), reviewed).review, ["1"], "accepted, 2.1 is done and not in review");
  assert.deepEqual(runsOf(tasks, ["2"], reviewed).runs.map((t) => t.number), ["2.2"]);
  assert.equal(taskToRun(tasks, "2", reviewed).number, "2.2");
  assert.equal(nextTask(tasks, new Set(["1", "2.1", "2.2"])), null, "전부 검토 중이면 다음은 없다");
});

test("칸 하나만 바꾼다 — 사람의 말: 받아들임(x), 접어 둠(-), 되돌림( )", () => {
  const done = withBox(KIRO, "2.1", "x");
  assert.equal(done, KIRO.replace("- [ ] 2.1", "- [x] 2.1"));
  const aside = withBox(done, "2.2", "-");
  assert.equal(aside, done.replace("- [ ] 2.2", "- [-] 2.2"));
  assert.equal(withBox(aside, "2.2", " "), done, "되돌리면 그대로");
  assert.equal(withBox(KIRO, "9", "x"), KIRO, "없는 번호는 아무것도 바꾸지 않는다");
  assert.equal(withDone(aside, new Set(["2.1"])), aside, "withDone은 접어 둔 칸을 건드리지 않는다");
});

test("a box set aside is outside the fingerprint, as a box ticked is", () => {
  assert.equal(blankBoxes("- [x] 1. a\n- [-] 2. b\n- [ ] 3. c\n"), "- [ ] 1. a\n- [ ] 2. b\n- [ ] 3. c\n");
});
