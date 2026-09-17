/**
 * 서버가 한 말이 파일에도 남는가, 그리고 그 파일이 자라기만 하지는 않는가.
 *
 * 콘솔을 감싸는 일은 되돌릴 수 없으므로(감싼 것을 벗기는 것은 이 파일의 일이 아니다)
 * 여기서는 줄을 만드는 규칙과 굴리는 규칙을 직접 물어본다. 감싸는 것 자체는 서버가
 * 시작할 때 한 번 일어나고, server.test.js가 실제로 남는지를 본다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lineOf, startLogging } from "../log.ts";

test("한 줄은 언제와 무엇을 말했는지다", () => {
  const at = new Date("2026-09-15T01:02:03.004Z");
  assert.equal(lineOf(at, ["listening on", 3000]), "2026-09-15T01:02:03.004Z listening on 3000\n");
  assert.match(lineOf(at, [new Error("boom")]), /boom/, "에러는 스택째로");
  assert.match(lineOf(at, [{ a: 1 }]), /\{"a":1\}\n$/, "객체는 읽을 수 있는 모양으로");
  const circular = { name: "self" };
  circular.self = circular;
  assert.doesNotThrow(() => lineOf(at, [circular]), "고리가 있어도 로그가 터지지는 않는다");
});

test("한계를 넘으면 굴러간다 — 쓰는 파일 하나, 그 뒤에 하나", () => {
  const dir = mkdtempSync(join(tmpdir(), "log-"));
  try {
    const file = join(dir, "logs", "server.log");
    const said = console.log;
    startLogging(file, 200);
    try {
      for (let i = 0; i < 20; i++) console.log(`line ${i} ${"x".repeat(20)}`);
    } finally {
      console.log = said;
    }
    assert.ok(existsSync(file), "쓰는 파일");
    assert.ok(existsSync(`${file}.1`), "그 앞의 파일");
    assert.ok(readFileSync(file, "utf8").includes("line 19"), "마지막 줄은 지금 파일에");
    assert.ok(!existsSync(`${file}.2`), "둘까지만 남는다");
    for (const f of [file, `${file}.1`]) assert.ok(readFileSync(f, "utf8").length <= 200 + 64, "각 파일은 한계 언저리를 넘지 않는다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("이미 있는 파일에 이어 쓰고, 그 크기를 이어서 센다", () => {
  const dir = mkdtempSync(join(tmpdir(), "log-"));
  try {
    const file = join(dir, "server.log");
    appendFileSync(file, "x".repeat(190));
    const said = console.log;
    startLogging(file, 200);
    try {
      console.log("this one pushes it over");
    } finally {
      console.log = said;
    }
    assert.equal(readFileSync(`${file}.1`, "utf8").length, 190, "앞서 있던 것은 그대로 뒤로 간다");
    assert.match(readFileSync(file, "utf8"), /this one pushes it over/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
