import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { watchNotes } from "../watcher.ts";

const DIR = mkdtempSync(join(tmpdir(), "watch-"));
mkdirSync(join(DIR, ".pi", "history"), { recursive: true });
mkdirSync(join(DIR, "deep"));
test.after(() => rmSync(DIR, { recursive: true, force: true }));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Events a watcher reports over a short window, once it has had time to start.
 *
 * A quarter of a second to settle, not the forty milliseconds this began
 * with: every claim here is "reported once", and on a busy machine the system
 * hands over the events of one write further apart than forty — on GitHub's
 * runner three quick writes came back as two reports, and on a laptop running
 * the whole suite a single new file did, one run in three.
 */
async function report(act, settle = 250) {
  const seen = [];
  const stop = watchNotes(DIR, (path) => seen.push(path), settle);
  await wait(150);
  act();
  await wait(settle * 3 + 280);
  stop();
  return seen;
}

test("노트가 쓰이면 그 경로가 한 번 보고된다", async () => {
  const seen = await report(() => {
    writeFileSync(join(DIR, "a.md"), "one\n");
    writeFileSync(join(DIR, "a.md"), "two\n");
    writeFileSync(join(DIR, "a.md"), "three\n");
  });
  assert.deepEqual(seen, ["a.md"], "연속된 쓰기는 하나로 접힌다");
});

test("하위 폴더의 노트도 경로째로 보고된다", async () => {
  const seen = await report(() => writeFileSync(join(DIR, "deep", "b.md"), "x\n"));
  assert.deepEqual(seen, ["deep/b.md"]);
});

test("노트가 아닌 것은 보고되지 않는다 — 로그, 숨김 폴더, 다른 확장자", async () => {
  const seen = await report(() => {
    writeFileSync(join(DIR, ".pi", "history", "a.md.jsonl"), "{}\n");
    writeFileSync(join(DIR, "notes.txt"), "x\n");
    writeFileSync(join(DIR, "a.md.tmp"), "x\n");
  });
  assert.deepEqual(seen, []);
});

test("문서가 생기면 노트처럼 보고되고, 숨김 폴더의 것은 아니다", async () => {
  const seen = await report(() => {
    writeFileSync(join(DIR, "deep", "paper.pdf"), "x\n");
    writeFileSync(join(DIR, ".pi", "cache.pdf"), "x\n");
  });
  assert.deepEqual(seen, ["deep/paper.pdf"]);
});

test("스펙이 쓰이면 보고되고, .octave의 다른 것은 아니다", async () => {
  mkdirSync(join(DIR, ".octave", "specs", "email-auth"), { recursive: true });
  const seen = await report(() => {
    writeFileSync(join(DIR, ".octave", "specs", "email-auth", "requirements.md"), "x\n");
    writeFileSync(join(DIR, ".octave", "specs", "email-auth", "notes.txt"), "x\n");
    writeFileSync(join(DIR, ".octave", "other.md"), "x\n");
  });
  assert.deepEqual(seen, [".octave/specs/email-auth/requirements.md"]);
});

test("승인 기록이 바뀌어도 보고된다 — 기다리는 문서가 달라지므로", async () => {
  mkdirSync(join(DIR, ".octave", "specs", "email-auth"), { recursive: true });
  const seen = await report(() => {
    writeFileSync(join(DIR, ".octave", "specs", "email-auth", "approvals.json"), "{}\n");
    writeFileSync(join(DIR, ".octave", "specs", "cache.json"), "{}\n");
  });
  assert.deepEqual(seen, [".octave/specs/email-auth/approvals.json"]);
});

test("노트가 아닌 파일은 누가 열어 두었을 때만 소식이다", async () => {
  const seen = [];
  const stop = watchNotes(DIR, (path) => seen.push(path), 40, (path) => path === "watched.ts");
  await wait(150);
  writeFileSync(join(DIR, "watched.ts"), "const a = 1;\n");
  writeFileSync(join(DIR, "ignored.ts"), "const b = 2;\n");
  await wait(400);
  stop();
  assert.deepEqual(seen, ["watched.ts"], "아무도 안 보는 파일은 빌드 하나에 수천 개가 된다");
});

test("멈춘 뒤에는 아무것도 보고되지 않는다", async () => {
  const seen = [];
  const stop = watchNotes(DIR, (path) => seen.push(path), 40);
  await wait(150);
  stop();
  writeFileSync(join(DIR, "after.md"), "x\n");
  await wait(300);
  assert.deepEqual(seen, []);
});

test("없는 폴더를 감시해도 죽지 않는다", () => {
  const stop = watchNotes(join(DIR, "nope"), () => {});
  stop();
});
