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

/** Events a watcher reports over a short window, once it has had time to start. */
async function report(act) {
  const seen = [];
  const stop = watchNotes(DIR, (path) => seen.push(path), 40);
  await wait(150);
  act();
  await wait(400);
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
