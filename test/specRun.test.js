import assert from "node:assert/strict";
import test from "node:test";

import { doneLines, runBlocked, runCommand, runMessage, runWhy, startLines, tasksBetween, underOf } from "../web/src/specRun.ts";

const PLAN = "# Implementation Plan\n\n- [ ] 1. Add the door\n  - _Requirements: 1.1_\n- [ ] 2. Hang the sign\n- [x] 2.1 Cut the board\n- [ ] 2.2 Paint it\n- [ ] 3. Lock up\n";
const at = (needle) => PLAN.indexOf(needle);
const numbers = (from, to) => tasksBetween(PLAN, from, to).map((task) => task.number);

test("보내는 것은 사람이 치는 것과 같다 — 스펙 이름, 번호들, 그리고 모델과 effort", () => {
  assert.equal(runCommand("email-auth", ["2.2", "3"]), "/spec-run email-auth 2.2 3");
  assert.equal(runCommand("email-auth", ["1"], { model: "anthropic/claude-sonnet-5", effort: "low" }), "/spec-run email-auth 1 anthropic/claude-sonnet-5 low");
  assert.equal(runCommand("email-auth", [], { model: null, effort: undefined }), "/spec-run email-auth", "아무것도 안 고르면 다음 작업");
  assert.deepEqual(runMessage("email-auth", ["1"]), { type: "prompt", text: "/spec-run email-auth 1", command: true, behavior: "followUp" });
});

test("선택이 덮는 줄의 작업들 — 한 글자만 걸쳐도 그 줄, 빈 선택은 커서의 줄", () => {
  assert.deepEqual(numbers(at("Add the door"), at("Add the door")), ["1"], "빈 선택");
  assert.deepEqual(numbers(at("door") + 2, at("Paint it") + 1), ["1", "2"], "1의 줄 중간에서 2.2의 줄 중간까지 — 2가 2.2를 품고, 2.1은 끝났다");
  assert.deepEqual(numbers(at("- [ ] 2.2") - 1, at("- [ ] 2.2") - 1), [], "줄 끝의 개행에 선 커서는 앞 줄(2.1, 끝남)의 것");
  assert.deepEqual(numbers(at("Paint it"), at("Paint it")), ["2.2"], "하위만 고르면 하위 그대로");
});

test("끝이 다음 줄 0열이면 그 줄은 빼지 않은 것이다 — 드래그는 개행 하나를 넘치기 쉽다", () => {
  const paint = at("- [ ] 2.2");
  const lock = at("- [ ] 3.");
  assert.deepEqual(numbers(paint, lock), ["2.2"], "2.2 줄 전체 + 개행: 3은 안 든다");
  assert.deepEqual(numbers(paint, lock + 1), ["2.2", "3"], "3의 첫 글자에 닿으면 든다");
  assert.deepEqual(numbers(lock, lock), ["3"], "빈 선택이 0열에 있으면 그 줄이다");
  assert.deepEqual(numbers(0, at("- [ ] 1.")), [], "제목만 선택하고 1의 0열에서 끝나면 아무것도 없다");
});

test("끝난 작업은 뺀다; 묶음은 남은 하위 전부를 뜻하고, 덮인 하위는 그 안으로 접힌다", () => {
  assert.deepEqual(numbers(0, PLAN.length), ["1", "2", "3"], "2가 2.2를 품고, 2.1은 끝남");
  assert.deepEqual(numbers(at("Hang the sign"), at("Cut the board")), ["2"], "묶음은 남은 하위(2.2)가 있으니 든다; 끝난 2.1은 아니다");
  const done = PLAN.replace("- [ ] 2.2", "- [x] 2.2");
  assert.deepEqual(tasksBetween(done, 0, done.length).map((task) => task.number), ["1", "3"], "남은 하위가 없는 묶음은 뺀다");
});

test("거꾸로 골라도 순서는 문서의 순서", () => {
  assert.deepEqual(numbers(at("Lock up"), at("Paint it")), ["2.2", "3"]);
});

test("작업이 아닌 줄은 세지 않는다 — 제목, 하위 글머리, 빈 줄", () => {
  assert.deepEqual(numbers(0, at("- [ ] 1.") - 1), []);
  assert.deepEqual(numbers(at("_Requirements"), at("_Requirements")), []);
});

test("CRLF 파일에서도 같은 줄이다", () => {
  const crlf = PLAN.replaceAll("\n", "\r\n");
  const from = crlf.indexOf("Paint it");
  assert.deepEqual(tasksBetween(crlf, from, from).map((task) => task.number), ["2.2"]);
});

const ready = { name: "email-auth", approved: 3, waiting: null, waitingAt: null, written: ["requirements.md", "design.md", "tasks.md"], tasks: { total: 3, done: 1, next: "1" } };
const fine = { online: true, streaming: false, compacting: false, hasCommand: true, spec: ready, count: 1, sent: false };

test("막을 이유가 없으면 막지 않는다; 이유는 가까운 것부터, 사람의 말로", () => {
  assert.equal(runBlocked(fine), null);
  assert.equal(runWhy(null), null);
  assert.equal(runBlocked({ ...fine, online: false }), "offline");
  assert.equal(runBlocked({ ...fine, streaming: true }), "busy", "명령은 큐에 들어가지 않는다");
  assert.equal(runBlocked({ ...fine, compacting: true }), "busy");
  assert.equal(runBlocked({ ...fine, hasCommand: false }), "no-command");
  assert.equal(runBlocked({ ...fine, spec: { ...ready, approved: 2 } }), "not-approved", "셋 다 승인 전에는 돌지 않는다");
  assert.equal(runBlocked({ ...fine, spec: null }), "not-approved");
  assert.equal(runBlocked({ ...fine, count: 0 }), "nothing");
  assert.equal(runBlocked({ ...fine, sent: true }), "sent");
  assert.equal(runBlocked({ ...fine, online: false, streaming: true, count: 0 }), "offline");
  assert.equal(runWhy("not-approved"), "Approve all three documents first");
  assert.equal(runWhy("nothing"), "No task here left to run");
  assert.equal(runWhy("sent"), "Starting…");
});

test("Start가 설 줄은 할 것이 남은 작업의 줄이다 — 묶음도, 남은 하위가 있으면; 줄의 시작 위치로", () => {
  assert.deepEqual(
    startLines(PLAN).map(({ from, task }) => [task.number, PLAN.slice(from, from + 9)]),
    [
      ["1", "- [ ] 1. "],
      ["2", "- [ ] 2. "],
      ["2.2", "- [ ] 2.2"],
      ["3", "- [ ] 3. "],
    ],
    "2.1은 끝남, 그 외 줄은 작업이 아니다",
  );
  assert.deepEqual(underOf(PLAN, "2"), ["2.2"], "묶음의 Start가 돌릴 것");
  assert.deepEqual(underOf(PLAN, "1"), [], "잎은 제 것");
  assert.deepEqual(startLines(""), []);
  assert.deepEqual(startLines("# Nothing here\n- just a bullet\n"), []);
  const crlf = PLAN.replaceAll("\n", "\r\n");
  assert.deepEqual(startLines(crlf).map(({ from }) => crlf.slice(from, from + 5)), ["- [ ]", "- [ ]", "- [ ]", "- [ ]"], "CRLF에서도 줄의 시작이다");
  assert.deepEqual(startLines(PLAN.replaceAll("- [ ]", "- [x]")), [], "전부 끝나면 하나도 없다");
});

test("결과가 설 줄은 끝난 잎 작업의 줄 끝이다 — 묶음에는 없고, 안 끝난 것에도 없다", () => {
  assert.deepEqual(doneLines(PLAN).map(({ to, task }) => [task.number, PLAN.slice(to - 5, to)]), [["2.1", "board"]], "2.1만 끝났다");
  const all = PLAN.replaceAll("- [ ]", "- [x]");
  assert.deepEqual(doneLines(all).map(({ task }) => task.number), ["1", "2.1", "2.2", "3"], "2는 묶음이라 제 커밋이 없다");
  const crlf = all.replaceAll("\n", "\r\n");
  assert.deepEqual(doneLines(crlf).map(({ to }) => crlf.slice(to, to + 2)), ["\r\n", "\r\n", "\r\n", "\r\n"], "CRLF에서는 \\r 앞이 줄의 끝이다");
  assert.deepEqual(doneLines(""), []);
});
