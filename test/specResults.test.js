import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { trailersOf } from "../spec.ts";
import { taskResults } from "../specResults.ts";

/** A repository, and a task's commit made in it the way spec.ts makes one. */
function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "spec-results-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  const write = (file, text) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  };
  write("README.md", "# app\n");
  git("add", "-A");
  git("commit", "-q", "-m", "app");
  const task = (spec, number, title, checks) => {
    git("add", "-A");
    git("commit", "-q", "-m", title, "-m", trailersOf({ spec, task: number }, checks));
    return git("rev-parse", "HEAD");
  };
  return { cwd, git, write, task };
}

test("작업마다 커밋 하나 — 번호, 제목, 검사, 그리고 스펙 폴더 밖에서 바뀐 것", async (t) => {
  const repo = repository(t);
  repo.write(".octave/specs/greeting/tasks.md", "- [x] 1. Add the greeting\n- [ ] 2. Test it\n");
  repo.write(".octave/specs/greeting/requirements.md", "# Requirements\n");
  repo.write("greeting.js", "export const greet = (name) => `Hello, ${name}!`;\n");
  const first = repo.task("greeting", "1", "Add the greeting", "inline check — passed");
  repo.write(".octave/specs/greeting/tasks.md", "- [x] 1. Add the greeting\n- [x] 2. Test it\n");
  repo.write("greeting.test.js", "import test from 'node:test';\ntest('greets', () => {});\n");
  repo.write("greeting.js", "export const greet = (name) => `Hello, ${name}!`;\nexport default greet;\n");
  const second = repo.task("greeting", "2", "Test it", null);

  const results = await taskResults(repo.cwd);
  assert.deepEqual([...results.keys()], ["greeting"]);
  const [one, two] = results.get("greeting");
  assert.equal(one.task, "1", "한 순서대로 — 오래된 것부터");
  assert.equal(one.commit, first);
  assert.equal(one.short, first.slice(0, one.short.length));
  assert.equal(one.title, "Add the greeting");
  assert.equal(one.checks, "inline check — passed");
  assert.equal(typeof one.at, "number");
  assert.deepEqual(one.files, [{ path: "greeting.js", added: 1, deleted: 0 }], "tasks.md와 세 문서는 작업의 일이 아니다");
  assert.deepEqual([one.added, one.deleted], [1, 0]);

  assert.equal(two.commit, second);
  assert.equal(two.checks, null, "Checks: none은 검사가 없다는 말이다");
  assert.deepEqual(two.files.map((file) => [file.path, file.added, file.deleted]).sort(), [["greeting.js", 1, 0], ["greeting.test.js", 2, 0]]);
  assert.deepEqual([two.added, two.deleted], [3, 0]);
});

test("스펙이 여럿이면 제 것끼리, 작업의 커밋이 아닌 것은 세지 않는다", async (t) => {
  const repo = repository(t);
  repo.write("a.js", "a\n");
  repo.task("email-auth", "1", "Add sign-in", "npm test — 9 passed");
  repo.write("b.js", "b\n");
  repo.git("add", "-A");
  // A person's own commit that happens to say the word, and has no trailers.
  repo.git("commit", "-q", "-m", "Notes", "-m", "Task: is a word I use in prose too, not at the end\n\nmore prose after it");
  repo.write("c.js", "c\n");
  repo.task("greeting", "2.1", "Cut the board", null);

  const results = await taskResults(repo.cwd);
  assert.deepEqual([...results.keys()].sort(), ["email-auth", "greeting"]);
  assert.deepEqual(results.get("email-auth").map((r) => r.task), ["1"]);
  assert.deepEqual(results.get("greeting").map((r) => [r.task, r.files.map((f) => f.path)]), [["2.1", ["c.js"]]]);
});

test("다시 돌린 작업은 돌린 만큼 있고, 이름을 바꾼 파일과 바이너리도 읽힌다", async (t) => {
  const repo = repository(t);
  repo.write("old name.js", "one\ntwo\n");
  repo.task("greeting", "1", "Add it", null);
  renameSync(join(repo.cwd, "old name.js"), join(repo.cwd, "new name.js"));
  writeFileSync(join(repo.cwd, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  repo.task("greeting", "1", "Add it", "second time");

  const runs = (await taskResults(repo.cwd)).get("greeting");
  assert.deepEqual(runs.map((r) => [r.task, r.checks]), [["1", null], ["1", "second time"]], "둘 다, 한 순서대로");
  const files = Object.fromEntries(runs[1].files.map((file) => [file.path, [file.added, file.deleted]]));
  assert.deepEqual(files["logo.png"], [null, null], "바이너리는 줄을 세지 않는다");
  assert.ok("new name.js" in files, `이름을 바꾼 파일은 새 이름으로: ${Object.keys(files).join(", ")}`);
  assert.deepEqual([runs[1].added, runs[1].deleted], [0, 0]);
});

test("저장소가 아니거나 작업이 아직 없으면 빈 것이다", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "spec-results-none-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.equal((await taskResults(cwd)).size, 0, "저장소가 아니다");
  const repo = repository(t);
  assert.equal((await taskResults(repo.cwd)).size, 0, "작업의 커밋이 없다");
});
