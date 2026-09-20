import assert from "node:assert/strict";
import test from "node:test";

import { nextTask, parseTasks, taskNumbered, withDone, withParents } from "../specTasks.ts";

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
    { number: "1", title: "Set up project structure and core interfaces", done: false },
    { number: "2", title: "Implement data models and validation", done: false },
    { number: "2.1", title: "Create core data model interfaces and types", done: false },
    { number: "2.2", title: "Implement User model with validation", done: false },
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
    { number: "1", title: "Lower", done: true },
    { number: "2", title: "Upper, no dot", done: true },
    { number: "3", title: "Open", done: false },
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

test("번호로 고르기", () => {
  const tasks = parseTasks(KIRO);
  assert.equal(taskNumbered(tasks, "2.2").title, "Implement User model with validation");
  assert.equal(taskNumbered(tasks, "2").number, "2", "묶음도 이름으로는 고를 수 있다");
  assert.equal(taskNumbered(tasks, "3"), null);
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
