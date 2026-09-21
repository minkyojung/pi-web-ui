import assert from "node:assert/strict";
import test from "node:test";

import { runBlocked, runCommand, runMessage, runWhy, tasksBetween } from "../web/src/specRun.ts";

const PLAN = "# Implementation Plan\n\n- [ ] 1. Add the door\n  - _Requirements: 1.1_\n- [x] 2. Hang the sign\n- [x] 2.1 Cut the board\n- [ ] 2.2 Paint it\n- [ ] 3. Lock up\n";
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
  assert.deepEqual(numbers(at("door") + 2, at("Paint it") + 1), ["1", "2.2"], "1의 줄 중간에서 2.2의 줄 중간까지 — 둘 다, 사이의 2와 2.1은 아니다");
  assert.deepEqual(numbers(at("- [ ] 2.2") - 1, at("- [ ] 2.2") - 1), [], "줄 끝의 개행에 선 커서는 앞 줄(2.1, 끝남)의 것");
});

test("끝난 작업과 묶음 상위는 뺀다 — 명령이 거절하고, 상위는 일이 아니다", () => {
  assert.deepEqual(numbers(0, PLAN.length), ["1", "2.2", "3"], "2는 묶음, 2.1은 끝남");
  assert.deepEqual(numbers(at("Hang the sign"), at("Cut the board")), [], "묶음과 끝난 것만 고르면 아무것도 없다");
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
