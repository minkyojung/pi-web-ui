import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { trailersOf } from "../spec.ts";
import { readTask } from "../taskRead.ts";

/** A repository, and pi's session dir for it, as a task's run leaves them. */
function folder(t) {
  const cwd = mkdtempSync(join(tmpdir(), "task-read-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "task-read-sessions-"));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  const write = (file, text) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  };
  write("README.md", "# app\n");
  git("add", "-A");
  git("commit", "-q", "-m", "app");
  /** A run's session: the mark, then what it said. */
  const ran = (task, ...said) => {
    const manager = SessionManager.create(cwd, sessionDir);
    manager.appendCustomMessageEntry("spec-task", "run it", false, { spec: "greeting", task, title: `Task ${task}`, done: [] });
    for (const text of said) manager.appendMessage({ role: "assistant", content: [{ type: "text", text }], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
    return manager.getSessionId();
  };
  /** Accepting, as spec.ts commits it. */
  const accept = (task, body, checks, session) => {
    git("add", "-A");
    git("commit", "-q", "-m", `Task ${task}`, ...(body ? ["-m", body] : []), "-m", trailersOf({ spec: "greeting", task }, checks, [{ name: "npm test", command: "npm test", exit: 0 }], session));
    return git("rev-parse", "HEAD");
  };
  return { cwd, sessionDir, git, write, ran, accept };
}

test("심사 중인 작업: 세션의 마지막 답이 보고, 작업 트리가 변경 — 이어 말하면 둘 다 새 것", async (t) => {
  const f = folder(t);
  f.write("greeting.js", "export const greet = () => 'hi';\n");
  const session = f.ran("1", "The door is in.\n\nChecks: npm test — 1 passed");
  const read = await readTask(f.cwd, "greeting", "1", f.sessionDir);
  assert.deepEqual([read.standing, read.title, read.report, read.checks, read.verified, read.commit, read.session], ["review", "Task 1", "The door is in.", "npm test — 1 passed", [], null, session]);
  assert.deepEqual(read.files.map((file) => [file.path, file.status, file.after]), [["greeting.js", "added", "export const greet = () => 'hi';\n"]]);
  // Another turn in the same session: the report is its last answer.
  const again = SessionManager.open((await SessionManager.list(f.cwd, f.sessionDir)).find((s) => s.id === session).path, f.sessionDir);
  again.appendMessage({ role: "user", content: "Say hello instead.", timestamp: Date.now() });
  again.appendMessage({ role: "assistant", content: [{ type: "text", text: "It says hello now.\nChecks: npm test — 2 passed" }], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  f.write("greeting.js", "export const greet = () => 'hello';\n");
  const later = await readTask(f.cwd, "greeting", "1", f.sessionDir);
  assert.deepEqual([later.report, later.checks, later.files[0].after], ["It says hello now.", "npm test — 2 passed", "export const greet = () => 'hello';\n"]);
});

test("받아들인 작업: 커밋의 본문이 보고, 커밋의 파일이 변경, 검사와 세션은 트레일러에서 — 같은 물음에 같은 모양으로", async (t) => {
  const f = folder(t);
  f.write("greeting.js", "export const greet = () => 'hi';\n");
  const session = f.ran("1", "The door is in.\n\nChecks: npm test — 1 passed");
  const hash = f.accept("1", "The door is in.", "npm test — 1 passed", session);
  const read = await readTask(f.cwd, "greeting", "1", f.sessionDir);
  assert.deepEqual([read.standing, read.title, read.report, read.checks, read.verified, read.session], ["done", "Task 1", "The door is in.", "npm test — 1 passed", [{ name: "npm test", exit: 0 }], session]);
  assert.deepEqual([read.commit.hash, read.commit.short], [hash, hash.slice(0, read.commit.short.length)]);
  assert.deepEqual(read.files.map((file) => [file.path, file.status]), [["greeting.js", "added"]]);
  // Run again after accepting: the new run is in review, over the folder, not the old commit.
  f.write("greeting.js", "export const greet = () => 'hey';\n");
  f.ran("1", "Now it says hey.\nChecks: none");
  const rerun = await readTask(f.cwd, "greeting", "1", f.sessionDir);
  assert.deepEqual([rerun.standing, rerun.report, rerun.checks, rerun.commit], ["review", "Now it says hey.", null, null]);
  assert.equal(rerun.files[0].status, "modified", "HEAD에 있는 파일이 바뀐 것");
});

test("돌린 적 없는 작업은 없는 것; 세션 없이 커밋만 있는 옛 작업은 그 커밋으로", async (t) => {
  const f = folder(t);
  assert.equal(await readTask(f.cwd, "greeting", "1", f.sessionDir), null);
  f.write("a.js", "x\n");
  const hash = f.accept("2", null, null, null);
  const read = await readTask(f.cwd, "greeting", "2", f.sessionDir);
  assert.deepEqual([read.standing, read.report, read.commit.hash, read.session], ["done", null, hash, null]);
});
