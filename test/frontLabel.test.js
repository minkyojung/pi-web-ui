import assert from "node:assert/strict";
import test from "node:test";

import { frontLabel } from "../web/src/frontLabel.ts";

const spec = (over = {}) => ({ name: "email-auth", results: [], review: [], ...over });

test("파일은 탭이 부르는 이름 그대로, 종류와 함께", () => {
  assert.deepEqual(frontLabel(null, "notes/Hello.md"), { kind: "note", name: "Hello" });
  assert.deepEqual(frontLabel(null, "src/front.ts"), { kind: "code", name: "front.ts" });
  assert.deepEqual(frontLabel(null, "papers/a.pdf"), { kind: "document", name: "a.pdf" });
});

test("task는 서 있는 자리와 번호와 줄로 — 심사 중이 먼저, 그다음 끝난 결과, 둘 다 없으면 할 일", () => {
  const specs = [spec({ review: [{ task: "3", title: "Set up auth" }], results: [{ task: "2", title: "Add login", commit: "bbbbbbb2" }] })];
  assert.deepEqual(frontLabel(specs, "octave://task/email-auth/3"), { kind: "task", id: "3", name: "Set up auth", standing: "review" });
  assert.deepEqual(frontLabel(specs, "octave://task/email-auth/2"), { kind: "task", id: "2", name: "Add login", standing: "done" });
  assert.deepEqual(frontLabel(specs, "octave://task/email-auth/4"), { kind: "task", id: "4", name: null, standing: "todo" });
  assert.deepEqual(frontLabel(null, "octave://task/email-auth/4"), { kind: "task", id: "4", name: null, standing: "todo" }, "창이 스펙을 아직 모르면 번호만");
});

test("커밋은 짧은 해시와, task의 결과면 그 task의 줄", () => {
  const specs = [spec({ results: [{ task: "2", title: "Add login", commit: "bbbbbbb2cafe", short: "bbbbbbb" }] })];
  assert.deepEqual(frontLabel(specs, "octave://commit/bbbbbbb2cafe"), { kind: "commit", id: "bbbbbbb", name: "Task 2 · Add login" });
  assert.deepEqual(frontLabel(specs, "octave://commit/1234567"), { kind: "commit", id: "1234567", name: null });
});

test("Changes는 이름대로, 대화와 상관없는 페이지는 없다", () => {
  assert.deepEqual(frontLabel(null, "octave://changes"), { kind: "changes", name: "Changes" });
  assert.equal(frontLabel(null, "octave://whats-new/0.0.9"), null);
  assert.equal(frontLabel(null, "octave://commit/not-a-hash"), null, "페이지가 아닌 앱 주소는 노트도 아니다");
});
