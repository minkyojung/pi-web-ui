import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { APPROVALS, SPEC_DOCS, approve, specState } from "../specApproval.ts";

/** A folder with one spec in it, written as the agent would write it. */
function folder(t) {
  const cwd = mkdtempSync(join(tmpdir(), "spec-approval-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const dir = join(cwd, ".octave/specs/email-auth");
  const write = (doc, text) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, doc), text);
  };
  const record = () => JSON.parse(readFileSync(join(dir, APPROVALS), "utf8"));
  const state = () => specState(cwd, "email-auth");
  return { cwd, dir, write, record, state, approve: () => approve(cwd, "email-auth") };
}

const print = (text) => createHash("sha256").update(text).digest("hex");

test("문서는 셋, 이 차례로", () => {
  assert.deepEqual(SPEC_DOCS, ["requirements.md", "design.md", "tasks.md"]);
});

test("쓴 것이 없으면 기다리는 것도, 승인한 것도 없다", (t) => {
  const spec = folder(t);
  assert.deepEqual(spec.state(), { approved: 0, waiting: null }, "폴더도 없을 때");
  mkdirSync(spec.dir, { recursive: true });
  assert.deepEqual(spec.state(), { approved: 0, waiting: null }, "빈 폴더");
  assert.equal(spec.approve(), null, "승인할 것이 없다");
  assert.equal(existsSync(join(spec.dir, APPROVALS)), false, "없는 승인은 적지 않는다");
});

test("쓰면 기다리고, 승인하면 다음 차례 — 세 문서를 차례로", (t) => {
  const spec = folder(t);
  spec.write("requirements.md", "# Requirements Document\n");
  assert.deepEqual(spec.state(), { approved: 0, waiting: "requirements.md" });

  assert.equal(spec.approve(), "requirements.md");
  assert.deepEqual(spec.state(), { approved: 1, waiting: null }, "설계는 아직 쓰이지 않았다");
  assert.deepEqual(spec.record(), { "requirements.md": [print("# Requirements Document\n")] }, "승인한 것의 지문");
  assert.equal(spec.approve(), null, "두 번 승인할 것은 없다");

  spec.write("design.md", "# Design Document\n");
  assert.deepEqual(spec.state(), { approved: 1, waiting: "design.md" });
  assert.equal(spec.approve(), "design.md");
  assert.deepEqual(spec.record()["design.md"], [print("# Requirements Document\n"), print("# Design Document\n")], "그 문서와 앞 문서들의 지문");

  spec.write("tasks.md", "# Implementation Plan\n");
  assert.deepEqual(spec.state(), { approved: 2, waiting: "tasks.md" });
  assert.equal(spec.approve(), "tasks.md");
  assert.deepEqual(spec.state(), { approved: 3, waiting: null }, "다 됐다");
});

test("승인한 문서를 고치면 그 문서와 뒤 문서의 승인이 풀린다 — 다시 승인하면 다음 문서가 기다린다", (t) => {
  const spec = folder(t);
  for (const doc of SPEC_DOCS) {
    spec.write(doc, `# ${doc}\n`);
    spec.approve();
  }
  assert.deepEqual(spec.state(), { approved: 3, waiting: null });

  spec.write("design.md", "# design.md\n\nMore.\n");
  assert.deepEqual(spec.state(), { approved: 1, waiting: "design.md" }, "요구사항은 그대로 승인");

  spec.write("requirements.md", "# requirements.md\n\nMore.\n");
  assert.deepEqual(spec.state(), { approved: 0, waiting: "requirements.md" }, "맨 앞을 고치면 전부");

  assert.equal(spec.approve(), "requirements.md");
  assert.deepEqual(spec.state(), { approved: 1, waiting: "design.md" }, "설계는 옛 요구사항에 대해 승인된 것이다");
  assert.equal(spec.approve(), "design.md", "설계를 그대로 두고 다시 승인할 수도 있다");
  assert.deepEqual(spec.state(), { approved: 2, waiting: "tasks.md" }, "작업 목록도 옛 설계에 대해 승인된 것이다");
});

test("공백 하나도 고친 것이다; 승인했던 글로 되돌리면 승인도 돌아온다", (t) => {
  const spec = folder(t);
  spec.write("requirements.md", "# Requirements Document\n");
  spec.approve();
  spec.write("requirements.md", "# Requirements Document\n\n");
  assert.deepEqual(spec.state(), { approved: 0, waiting: "requirements.md" });
  spec.write("requirements.md", "# Requirements Document\n");
  assert.deepEqual(spec.state(), { approved: 1, waiting: null }, "지문은 글에 달려 있다");
});

test("문서가 사라지면 거기서 멈춘다", (t) => {
  const spec = folder(t);
  for (const doc of SPEC_DOCS) {
    spec.write(doc, `# ${doc}\n`);
    spec.approve();
  }
  rmSync(join(spec.dir, "design.md"));
  assert.deepEqual(spec.state(), { approved: 1, waiting: null }, "설계를 다시 쓸 차례");
});

test("기록이 깨졌거나 모양이 다르면 아무것도 승인되지 않은 것으로 — 닫힌 쪽으로 틀린다", (t) => {
  const spec = folder(t);
  spec.write("requirements.md", "# Requirements Document\n");
  spec.write("design.md", "# Design Document\n");
  const r = print("# Requirements Document\n");
  const d = print("# Design Document\n");
  for (const broken of ["{", "[]", "null", '"x"', JSON.stringify({ "requirements.md": r }), JSON.stringify({ "requirements.md": [r, d] })]) {
    writeFileSync(join(spec.dir, APPROVALS), broken);
    assert.deepEqual(spec.state(), { approved: 0, waiting: "requirements.md" }, broken);
  }
  // Design's record alone, as a hand might leave it: approval runs from the first document.
  writeFileSync(join(spec.dir, APPROVALS), JSON.stringify({ "design.md": [r, d] }));
  assert.deepEqual(spec.state(), { approved: 0, waiting: "requirements.md" }, "앞 문서의 승인 없이 뒤 문서만");
  // Approving writes a good record over a broken one, and keeps what it does not understand.
  writeFileSync(join(spec.dir, APPROVALS), JSON.stringify({ "design.md": [r, d], note: "kept" }));
  assert.equal(spec.approve(), "requirements.md");
  assert.deepEqual(spec.record(), { "design.md": [r, d], note: "kept", "requirements.md": [r] });
  assert.deepEqual(spec.state(), { approved: 2, waiting: null }, "그러면 설계의 기록도 맞는다");
  writeFileSync(join(spec.dir, APPROVALS), "{");
  assert.equal(spec.approve(), "requirements.md");
  assert.deepEqual(spec.record(), { "requirements.md": [r] });
});

test("기록은 사람이 읽을 수 있는 JSON이다 — PR에서 보인다", (t) => {
  const spec = folder(t);
  spec.write("requirements.md", "x");
  spec.approve();
  const text = readFileSync(join(spec.dir, APPROVALS), "utf8");
  assert.equal(text, `{\n  "requirements.md": [\n    "${print("x")}"\n  ]\n}\n`);
});

// --- the tasks, whose boxes are progress rather than a change to the plan ---

const PLAN = "# Implementation Plan\n\n- [ ] 1. One\n- [ ] 2. Two\n";

/** A spec approved to the end, its tasks as PLAN. */
function planned(t) {
  const spec = folder(t);
  spec.write("requirements.md", "# Requirements Document\n");
  spec.approve();
  spec.write("design.md", "# Design Document\n");
  spec.approve();
  spec.write("tasks.md", PLAN);
  spec.approve();
  assert.deepEqual(spec.state(), { approved: 3, waiting: null });
  return spec;
}

test("작업을 끝내 칸을 체크해도 승인은 그대로다 — 승인한 것은 계획이지 진척이 아니다", (t) => {
  const spec = planned(t);
  spec.write("tasks.md", "# Implementation Plan\n\n- [x] 1. One\n- [ ] 2. Two\n");
  assert.deepEqual(spec.state(), { approved: 3, waiting: null }, "하나 끝냄");
  spec.write("tasks.md", "# Implementation Plan\n\n- [x] 1. One\n- [X] 2. Two\n");
  assert.deepEqual(spec.state(), { approved: 3, waiting: null }, "전부 끝냄 — 대문자 X도 끝난 것");
  spec.write("tasks.md", PLAN);
  assert.deepEqual(spec.state(), { approved: 3, waiting: null }, "칸을 되돌려도");
});

test("작업 목록의 본문을 고치면 승인이 풀린다 — 칸만 예외다", (t) => {
  const spec = planned(t);
  spec.write("tasks.md", "# Implementation Plan\n\n- [x] 1. One\n- [ ] 2. Two and a half\n");
  assert.deepEqual(spec.state(), { approved: 2, waiting: "tasks.md" }, "제목이 바뀌었다");
  spec.write("tasks.md", "# Implementation Plan\n\n- [x] 1. One\n- [ ] 2. Two\n\n");
  assert.deepEqual(spec.state(), { approved: 2, waiting: "tasks.md" }, "빈 줄 하나도 고친 것이다");
});

test("앞 두 문서는 칸이 있어도 그대로 엄격하다", (t) => {
  const spec = folder(t);
  spec.write("requirements.md", "- [ ] 1. A box in the requirements\n");
  spec.approve();
  spec.write("requirements.md", "- [x] 1. A box in the requirements\n");
  assert.deepEqual(spec.state(), { approved: 0, waiting: "requirements.md" });
});

test("기록에 적히는 작업 목록의 지문은 칸을 비운 글의 것이다", (t) => {
  const spec = folder(t);
  spec.write("requirements.md", "r");
  spec.approve();
  spec.write("design.md", "d");
  spec.approve();
  spec.write("tasks.md", "- [x] 1. Already done when it was approved\n");
  spec.approve();
  assert.equal(spec.record()["tasks.md"].at(-1), print("- [ ] 1. Already done when it was approved\n"));
});
