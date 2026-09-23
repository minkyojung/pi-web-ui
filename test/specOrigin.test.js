import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inheritedSpecs } from "../specOrigin.ts";

const run = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();

/** A folder, gone when the test is. */
function folder(t, name) {
  const path = mkdtempSync(join(tmpdir(), `${name}-`));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/** A spec's requirements written in `cwd`, as the agent writes them. */
function spec(cwd, name) {
  mkdirSync(join(cwd, ".octave/specs", name), { recursive: true });
  writeFileSync(join(cwd, ".octave/specs", name, "requirements.md"), `# ${name}\n`);
}

/** A clone whose `main` already has the specs named, and a workspace branched off it. */
function workspace(t, ...merged) {
  const origin = folder(t, "spec-origin-main");
  run(origin, "init", "-q", "-b", "main");
  writeFileSync(join(origin, "README.md"), "# app\n");
  for (const name of merged) spec(origin, name);
  run(origin, "add", "-A");
  run(origin, "commit", "-q", "-m", "app");
  const cwd = join(folder(t, "spec-origin-work"), "work");
  run(tmpdir(), "clone", "-q", origin, cwd);
  run(cwd, "checkout", "-q", "-b", "someone/stay-reservation");
  return { cwd, origin };
}

test("이 브랜치가 갈라진 뒤에 생긴 스펙만 이 워크스페이스의 것이다", (t) => {
  const { cwd } = workspace(t, "airbnb-clone-page");
  // Merged into main long ago, and on the disk here only because a workspace
  // is made from main: another branch's work.
  assert.deepEqual([...inheritedSpecs(cwd)], ["airbnb-clone-page"]);

  // Written here and not committed yet — the first thing /spec does.
  spec(cwd, "stay-reservation");
  assert.equal(inheritedSpecs(cwd).has("stay-reservation"), false);

  // And committed, which does not make it the base's.
  run(cwd, "add", "-A");
  run(cwd, "commit", "-q", "-m", "the spec");
  assert.deepEqual([...inheritedSpecs(cwd)], ["airbnb-clone-page"]);
});

test("main이 앞서가도 여기서 시작한 스펙은 여기 것이다", (t) => {
  const { cwd, origin } = workspace(t, "airbnb-clone-page");
  spec(cwd, "stay-reservation");
  run(cwd, "add", "-A");
  run(cwd, "commit", "-q", "-m", "the spec");
  // Somebody else's work lands on main while this branch is still going.
  spec(origin, "reservation-request-flow");
  run(origin, "add", "-A");
  run(origin, "commit", "-q", "-m", "theirs");
  run(cwd, "fetch", "-q", "origin");
  assert.deepEqual([...inheritedSpecs(cwd)], ["airbnb-clone-page"], "갈라진 자리가 기준이다 — 그 뒤 main에 무엇이 오든");
});

test("main에 스펙이 하나도 없던 저장소에서는 상속할 것이 없다", (t) => {
  const { cwd } = workspace(t);
  spec(cwd, "stay-reservation");
  assert.deepEqual([...inheritedSpecs(cwd)], []);
});

test("git이 답할 수 없으면 전부 이 워크스페이스의 것이다", (t) => {
  const bare = folder(t, "spec-origin-bare");
  spec(bare, "alone");
  assert.deepEqual([...inheritedSpecs(bare)], [], "저장소가 아닌 폴더");

  const alone = folder(t, "spec-origin-remoteless");
  run(alone, "init", "-q", "-b", "main");
  spec(alone, "alone");
  run(alone, "add", "-A");
  run(alone, "commit", "-q", "-m", "app");
  assert.deepEqual([...inheritedSpecs(alone)], [], "remote가 없어 base도 없는 저장소");
});
