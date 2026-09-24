import assert from "node:assert/strict";
import test from "node:test";

import { docPath, docStanding, docTitle, mine, speaksFor, standingOf, standingWord, stateWords, waitingLine, waitingSpec } from "../web/src/specStanding.ts";

/** A spec as the server describes it (SpecInfo). */
const spec = (name, { own = true, approved = 0, waiting = null, waitingAt = waiting ? 1000 : null, written = waiting ? [waiting] : [], tasks = null } = {}) => ({
  name,
  own,
  approved,
  waiting,
  waitingAt,
  written,
  tasks,
});

test("문서의 자리는 스펙 폴더 안이다", () => {
  assert.equal(docPath("email-auth", "design.md"), ".octave/specs/email-auth/design.md");
});

test("기다리는 스펙은 가장 최근에 쓰인 것이고, 없으면 없다", () => {
  assert.equal(waitingSpec([]), null);
  assert.equal(waitingSpec([spec("a")]), null, "아무도 기다리지 않는다");
  assert.equal(waitingSpec([spec("a", { waiting: "requirements.md" })]).name, "a");
  const two = [spec("a", { waiting: "requirements.md", waitingAt: 1000 }), spec("b", { waiting: "design.md", waitingAt: 2000 })];
  assert.equal(waitingSpec(two).name, "b");
  assert.equal(waitingSpec([...two].reverse()).name, "b", "순서가 아니라 시각으로");
  const same = [spec("a", { waiting: "requirements.md", waitingAt: null }), spec("b", { waiting: "requirements.md", waitingAt: null })];
  assert.equal(waitingSpec(same).name, "b", "잴 수 없으면 나중에 적힌 것");
});

test("문서마다 넷 중 하나다 — 승인됨·대기·써졌지만 승인 아님·아직 안 씀", () => {
  const back = spec("back", { approved: 0, waiting: "requirements.md", written: ["requirements.md", "design.md", "tasks.md"] });
  assert.equal(docStanding(back, "requirements.md"), "waiting");
  assert.equal(docStanding(back, "design.md"), "written", "셋 다 쓴 뒤 요구사항을 고치면 설계는 남아 있되 승인이 아니다");
  const half = spec("half", { approved: 1, waiting: "design.md", written: ["requirements.md", "design.md"] });
  assert.equal(docStanding(half, "requirements.md"), "approved");
  assert.equal(docStanding(half, "design.md"), "waiting");
  assert.equal(docStanding(half, "tasks.md"), "unwritten");
  const planned = spec("planned", { approved: 2, written: ["requirements.md", "design.md", "tasks.md"] });
  assert.equal(docStanding(planned, "tasks.md"), "ready", "작업 목록은 승인이 아니라 준비다");
});

test("스펙을 대표하는 문서는 기다리는 것이고, 없으면 지금 와 있는 자리다", () => {
  assert.deepEqual(standingOf(spec("a", { approved: 1, waiting: "design.md", written: ["requirements.md", "design.md"] })), {
    doc: "design.md",
    standing: "waiting",
  });
  assert.deepEqual(standingOf(spec("a", { approved: 2, written: ["requirements.md", "design.md", "tasks.md"] })), {
    doc: "tasks.md",
    standing: "ready",
  }, "둘 다 승인되고 작업이 쓰였으면 마지막 문서를 말한다");
  assert.deepEqual(standingOf(spec("a", { approved: 1, written: ["requirements.md"] })), {
    doc: "design.md",
    standing: "unwritten",
  }, "승인했고 다음은 아직 안 쓴 사이");
});

test("이름표가 가리키는 스펙: 기다리는 것 → 읽고 있는 것 → 첫째", () => {
  const list = [spec("first", { approved: 1, written: ["requirements.md"] }), spec("second", { approved: 1, written: ["requirements.md"] })];
  assert.equal(speaksFor(list, null).name, "first", "할 일도 읽던 것도 없으면 첫째");
  assert.equal(speaksFor(list, ".octave/specs/second/requirements.md").name, "second", "읽고 있는 문서의 스펙");
  assert.equal(speaksFor(list, "a-note.md").name, "first", "노트를 읽고 있으면 첫째로 돌아간다");
  const waiting = [list[0], spec("second", { waiting: "design.md" })];
  assert.equal(speaksFor(waiting, ".octave/specs/first/requirements.md").name, "second", "기다리는 것이 읽고 있는 것을 이긴다");
  assert.equal(speaksFor([], null), null);
});

test("다른 브랜치가 시작한 스펙은 이 창이 대변하지 않는다", () => {
  // main에서 딸려온 스펙: 폴더에는 있지만 이 워크스페이스의 일이 아니다.
  const theirs = spec("airbnb-clone-page", { own: false, waiting: "design.md", waitingAt: 2000 });
  const ours = spec("stay-reservation", { waiting: "requirements.md", waitingAt: 1000 });
  assert.deepEqual(mine([theirs, ours]).map((s) => s.name), ["stay-reservation"]);
  assert.equal(waitingSpec([theirs, ours]).name, "stay-reservation", "남의 것이 더 새것이어도");
  assert.equal(speaksFor([theirs, ours], null).name, "stay-reservation");
  assert.equal(speaksFor([theirs], ".octave/specs/airbnb-clone-page/design.md"), null, "그 문서를 읽고 있어도 이 창이 말할 것은 아니다");
  assert.equal(speaksFor([theirs], null), null, "이 워크스페이스가 시작한 스펙이 없으면 이름표도 없다");
});

test("사람에게 보일 말", () => {
  assert.equal(docTitle("requirements.md"), "Requirements");
  assert.equal(standingWord("unwritten"), "Not written yet");
  assert.equal(stateWords(spec("a", { waiting: "requirements.md" })), "Requirements waiting");
  assert.equal(stateWords(spec("a", { approved: 2, written: ["requirements.md", "design.md", "tasks.md"] })), "Tasks ready");
  assert.equal(stateWords(spec("a", { approved: 1, written: ["requirements.md"] })), "Design not written yet");
  assert.equal(waitingLine("design.md"), "Design waiting for your approval");
});

test("버튼의 말은 진행이 아니라 문서와 그 자리다", () => {
  const all = ["requirements.md", "design.md", "tasks.md"];
  const going = spec("a", { approved: 2, written: all, tasks: { total: 8, done: 3, cancelled: 0, next: "2.2", review: [] } });
  assert.equal(stateWords(going), "Tasks ready", "작업이 진행 중이어도 버튼은 문서를 말한다");
  assert.equal(stateWords(spec("a", { approved: 1, waiting: "design.md", written: ["requirements.md", "design.md"] })), "Design waiting");
});
