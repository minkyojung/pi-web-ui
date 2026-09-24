import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { inReview, runSessions, taskRuns } from "../specRuns.ts";

/** A folder and pi's session dir for it, as pi keeps them apart. */
function folder(t) {
  const cwd = mkdtempSync(join(tmpdir(), "spec-runs-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "spec-runs-sessions-"));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  });
  /** A session, written as pi writes one: the run's mark and its answer, or plain conversation. */
  const session = (mark, ...said) => {
    const manager = SessionManager.create(cwd, sessionDir);
    if (mark) manager.appendCustomMessageEntry("spec-task", "run it", false, mark);
    else manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
    for (const text of said) manager.appendMessage({ role: "assistant", content: [{ type: "text", text }], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
    return manager.getSessionId();
  };
  return { cwd, sessionDir, session };
}

const mark = (task, then = []) => ({ spec: "email-auth", task, title: `Task ${task}`, done: [], then });

test("작업의 실행은 세션에서 읽는다 — 표식이 있는 세션만, 오래된 것부터, 표식과 세션 id와 함께", async (t) => {
  const f = folder(t);
  f.session(null, "just talking");
  const one = f.session(mark("1", ["2.1"]), "The door is in.\nChecks: none");
  await new Promise((r) => setTimeout(r, 20));
  const two = f.session(mark("2.1"), "The board is cut.");
  const runs = await taskRuns(f.cwd, f.sessionDir);
  assert.deepEqual(runs.map((run) => [run.spec, run.task, run.title, run.then, run.session]), [
    ["email-auth", "1", "Task 1", ["2.1"], one],
    ["email-auth", "2.1", "Task 2.1", [], two],
  ]);
  assert.ok(runs[0].at <= runs[1].at, "at은 세션이 마지막으로 쓰인 때");
  const sessions = await runSessions(f.cwd, f.sessionDir);
  assert.deepEqual(sessions.map((run) => run.id), [two, one], "세션은 새것부터, 그 안의 entries로 보고를 읽는다");
  assert.ok(sessions[1].entries.some((entry) => entry.type === "message" && entry.message?.role === "assistant"));
  assert.deepEqual(await taskRuns(join(f.cwd, "nowhere"), join(f.sessionDir, "nowhere")), [], "세션이 없으면 없는 것");
});

test("심사 중은 작업마다 가장 새 실행이고, 커밋이 그 세션을 이름하지 않은 것 — 받아들인 뒤 다시 돌리면 다시 심사 중, 받아들인 것을 다시 열면 아니다", () => {
  const run = (task, session, at) => ({ spec: "email-auth", task, title: "", then: [], session, at });
  const runs = [run("1", "a", 1), run("2.1", "b", 2), run("1", "c", 3), run("2.2", "d", 4)];
  assert.deepEqual(inReview(runs, new Set()).map((r) => r.session), ["b", "c", "d"], "1은 가장 새 실행 c로");
  assert.deepEqual(inReview(runs, new Set(["c"])).map((r) => r.session), ["b", "d"], "c가 받아들여졌으면 1은 심사 중이 아니다 — a는 지난 실행");
  assert.deepEqual(inReview(runs, new Set(["a"])).map((r) => r.session), ["b", "c", "d"], "a를 받아들인 뒤 다시 돌린 c는 심사 중");
  assert.deepEqual(inReview([], new Set(["a"])), []);
});
