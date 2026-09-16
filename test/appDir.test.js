import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claimAppDir, GITIGNORE } from "../appDir.ts";

const temp = () => mkdtempSync(join(tmpdir(), "appdir-test-"));

test("앱 폴더가 생기면서 git에 무엇을 남길지 함께 적힌다", () => {
  const dir = temp();
  try {
    assert.equal(claimAppDir(dir), true);
    const written = readFileSync(join(dir, ".pi/.gitignore"), "utf8");
    assert.equal(written, GITIGNORE);
    const lines = written.split("\n").filter((l) => l && !l.startsWith("#"));
    assert.deepEqual(lines, ["*.snapshot.json", "links.json", "trash/"], "다시 만들 수 있는 것과 이 기계의 것만");
    assert.equal(lines.some((l) => l.includes("history")), false, "기록은 노트와 함께 간다");
    assert.equal(lines.some((l) => l.includes("properties")), false, "고른 것도 함께 간다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("사람이 이미 답해 두었으면 그 답을 덮지 않는다", () => {
  const dir = temp();
  try {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi/.gitignore"), "*\n");
    assert.equal(claimAppDir(dir), false);
    assert.equal(readFileSync(join(dir, ".pi/.gitignore"), "utf8"), "*\n");
    assert.equal(existsSync(join(dir, ".pi")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
