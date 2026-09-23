import assert from "node:assert/strict";
import test from "node:test";

import { defaultMode, modeOf, other } from "../web/src/readMode.ts";

test("스펙 문서는 읽기로, 나머지는 편집으로 열린다", () => {
  assert.equal(defaultMode(".octave/specs/email-auth/tasks.md"), "read");
  assert.equal(defaultMode(".octave/specs/email-auth/requirements.md"), "read");
  assert.equal(defaultMode("Notes/today.md"), "edit");
  // 저장소의 README도 서버에게는 노트다 — 앱이 가를 수 없는 선은 긋지 않는다.
  assert.equal(defaultMode("README.md"), "edit");
  // 스펙 폴더 아래라도 마크다운이 아니면 스펙이 아니다(documentKinds).
  assert.equal(defaultMode(".octave/specs/email-auth/approvals.json"), "edit");
});

test("고른 것이 기본값을 이긴다", () => {
  const chosen = new Map([[".octave/specs/email-auth/tasks.md", "edit"], ["Notes/today.md", "read"]]);
  assert.equal(modeOf(chosen, ".octave/specs/email-auth/tasks.md"), "edit");
  assert.equal(modeOf(chosen, "Notes/today.md"), "read");
  assert.equal(modeOf(chosen, "Notes/other.md"), "edit", "고른 적 없으면 기본값");
});

test("앞에 아무것도 없으면 물어볼 것도 없다", () => {
  assert.equal(modeOf(new Map(), null), "edit");
});

test("반대쪽", () => {
  assert.equal(other("read"), "edit");
  assert.equal(other("edit"), "read");
});
