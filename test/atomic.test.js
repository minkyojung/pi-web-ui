/**
 * A file lands whole or not at all.
 *
 * The half of this that matters — that a reader never finds a torn file —
 * cannot be asked of a process that is still alive, since the tear needs a
 * crash in the middle of a write. What can be asked is the mechanism that
 * makes it impossible: the text goes to a temporary name and is renamed onto
 * the real one, so the write lands, replaces what was there, brings its folder
 * with it, and leaves nothing beside it. A temporary file that outlives the
 * write would be a `.tmp` sitting in someone's notes folder forever.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAtomic } from "../atomic.ts";

const temp = () => mkdtempSync(join(tmpdir(), "atomic-test-"));

test("쓰기는 폴더를 만들고, 내용을 남기고, 곁에 아무것도 남기지 않는다", () => {
  const dir = temp();
  try {
    const file = join(dir, "sub", "here.json");
    writeAtomic(file, '{"a":1}');
    assert.equal(readFileSync(file, "utf8"), '{"a":1}');
    assert.deepEqual(readdirSync(join(dir, "sub")), ["here.json"], "임시 파일은 남지 않는다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("이미 있는 파일을 통째로 갈아 끼운다 — 덧쓰지 않는다", () => {
  const dir = temp();
  try {
    const file = join(dir, "here.json");
    writeFileSync(file, '{"long":"the file that was here before, which is longer"}');
    writeAtomic(file, '{"a":1}');
    assert.equal(readFileSync(file, "utf8"), '{"a":1}', "앞 파일의 꼬리가 남지 않는다");
    assert.deepEqual(readdirSync(dir), ["here.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
