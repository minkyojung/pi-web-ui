import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { isCommitName, readCommit, readWorking, statusIn } from "../commitRead.ts";
import { CODE_MAX } from "../vault.ts";

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "commit-read-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  const write = (file, text) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  };
  const commit = (title, ...body) => {
    git("add", "-A");
    git("commit", "-q", "-m", title, ...body.flatMap((part) => ["-m", part]));
    return git("rev-parse", "HEAD");
  };
  return { cwd, git, write, commit };
}

const byPath = (read) => Object.fromEntries(read.files.map((file) => [file.path, file]));

test("작업의 커밋: 누구 것인지, 그리고 파일마다 전과 후 — 스펙 폴더의 것은 표시해서", async (t) => {
  const repo = repository(t);
  repo.write("greeting.js", "export const greet = (name) => `Hi, ${name}`;\n");
  repo.write("README.md", "# app\n");
  repo.commit("app");
  repo.write("greeting.js", "export const greet = (name) => `Hello, ${name}!`;\n");
  repo.write("greeting.test.js", "import test from 'node:test';\n");
  repo.write(".octave/specs/greeting/tasks.md", "- [x] 1. Greet properly\n");
  const hash = repo.commit("Greet properly", "Spec: greeting\nTask: 1\nChecks: npm test — 1 passed");

  const read = await readCommit(repo.cwd, hash);
  assert.equal(read.commit, hash);
  assert.equal(read.title, "Greet properly");
  assert.deepEqual([read.spec, read.task, read.checks], ["greeting", "1", "npm test — 1 passed"]);
  assert.equal(read.body, null, "트레일러뿐이면 본문은 없다");
  assert.equal(read.truncated, false);
  const files = byPath(read);
  assert.deepEqual(Object.keys(files).sort(), [".octave/specs/greeting/tasks.md", "greeting.js", "greeting.test.js"]);
  assert.deepEqual(files["greeting.js"], { path: "greeting.js", from: null, status: "modified", shown: "text", before: "export const greet = (name) => `Hi, ${name}`;\n", after: "export const greet = (name) => `Hello, ${name}!`;\n", added: 1, deleted: 1, spec: false });
  assert.deepEqual([files["greeting.test.js"].status, files["greeting.test.js"].before, files["greeting.test.js"].after], ["added", null, "import test from 'node:test';\n"]);
  assert.equal(files[".octave/specs/greeting/tasks.md"].spec, true, "커밋에는 있고, 작업의 일은 아니다");
  // By its short name too, which is what a person has.
  assert.equal((await readCommit(repo.cwd, hash.slice(0, 7))).commit, hash);
});

test("지운 파일, 이름을 바꾼 파일, 바이너리, 너무 큰 파일 — 그린 것이 거짓이 되지 않게", async (t) => {
  const repo = repository(t);
  repo.write("gone.js", "bye\n");
  repo.write("old name.js", "one\ntwo\nthree\nfour\nfive\n");
  repo.write("big.txt", "small\n");
  repo.commit("app");
  unlinkSync(join(repo.cwd, "gone.js"));
  renameSync(join(repo.cwd, "old name.js"), join(repo.cwd, "new name.js"));
  writeFileSync(join(repo.cwd, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  repo.write("big.txt", "x".repeat(CODE_MAX + 10));
  const hash = repo.commit("Shuffle");

  const files = byPath(await readCommit(repo.cwd, hash));
  assert.deepEqual([files["gone.js"].status, files["gone.js"].before, files["gone.js"].after], ["deleted", "bye\n", null]);
  assert.deepEqual([files["new name.js"].status, files["new name.js"].from], ["renamed", "old name.js"]);
  assert.equal(files["new name.js"].before, files["new name.js"].after, "이름만 바뀌었다");
  assert.deepEqual([files["logo.png"].shown, files["logo.png"].before, files["logo.png"].after], ["binary", null, null]);
  assert.deepEqual([files["logo.png"].added, files["logo.png"].deleted], [null, null], "바이너리는 줄을 세지 않는다");
  assert.deepEqual([files["gone.js"].added, files["gone.js"].deleted], [0, 1], "git이 센 그대로");
  assert.deepEqual([files["new name.js"].added, files["new name.js"].deleted], [0, 0]);
  assert.deepEqual([files["big.txt"].shown, files["big.txt"].before, files["big.txt"].after], ["large", null, null], "잘라서 비교하면 없는 차이가 생긴다");
});

test("부모가 없는 커밋은 아무것도 아닌 것과 비교한다 — 전부 새 파일", async (t) => {
  const repo = repository(t);
  repo.write("a.js", "a\n");
  const hash = repo.commit("first");
  const read = await readCommit(repo.cwd, hash);
  assert.deepEqual(read.files.map((file) => [file.path, file.status, file.before, file.after, file.added, file.deleted]), [["a.js", "added", null, "a\n", 1, 0]]);
  assert.deepEqual([read.spec, read.task, read.checks], [null, null, null], "작업의 커밋이 아니면 누구 것도 아니다");
});

test("앱의 폴더 .pi/는 커밋에 있어도 내주지 않는다", async (t) => {
  const repo = repository(t);
  repo.write("a.js", "a\n");
  repo.write(".pi/state.json", "{}\n");
  const hash = repo.commit("both");
  assert.deepEqual((await readCommit(repo.cwd, hash)).files.map((file) => file.path), ["a.js"]);
});

test("커밋의 이름은 16진 해시뿐이다 — 창에서 온 말을 그대로 git에 넘기지 않는다", async (t) => {
  const repo = repository(t);
  repo.write("a.js", "a\n");
  const hash = repo.commit("first");
  for (const name of ["HEAD", "main", "HEAD~1", "--all", "-n1", `${hash}^`, `${hash}:a.js`, "", "abc", "ABCDEF1", null, 42, `${hash} --stat`]) {
    assert.equal(isCommitName(name), false, String(name));
    assert.equal(await readCommit(repo.cwd, name), null, String(name));
  }
  assert.equal(await readCommit(repo.cwd, "0123456789abcdef0123456789abcdef01234567"), null, "모양은 맞지만 없는 커밋");
  const cwd = mkdtempSync(join(tmpdir(), "commit-read-none-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.equal(await readCommit(cwd, hash), null, "저장소가 아니다");
});

test("본문은 제목 아래, 트레일러 위의 글이다 — 본문 안의 `Key: value` 줄은 트레일러가 아니고, 트레일러 없는 커밋은 본문 전부", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  const plain = repo.commit("Plain", "Just a body.\n\nAnd a second paragraph of it.");
  assert.equal((await readCommit(repo.cwd, plain)).body, "Just a body.\n\nAnd a second paragraph of it.");
  // git's own rule: a last paragraph of `Key: value` lines is trailers, whoever wrote it — so a task's commit puts its trailers last (spec.ts).
  repo.write("a.txt", "b\n");
  const task = repo.commit("Do it", "The door opens outward: the design did not say.\n\nSee: the hinge is on the left.", "Spec: s\nTask: 1\nChecks: none\nSession: x");
  const read = await readCommit(repo.cwd, task);
  assert.equal(read.body, "The door opens outward: the design did not say.\n\nSee: the hinge is on the left.");
  assert.deepEqual([read.spec, read.task], ["s", "1"], "트레일러는 여전히 읽힌다");
  repo.write("a.txt", "c\n");
  const bare = repo.commit("Bare");
  assert.equal((await readCommit(repo.cwd, bare)).body, null);
});

test("작업 트리: HEAD와 다른 파일마다 전(HEAD)과 후(디스크) — 새 파일, 고친 파일, 지운 파일, 앱의 폴더는 빼고, 스펙 폴더는 표시해서", async (t) => {
  const repo = repository(t);
  repo.write("greeting.js", "export const greet = (name) => `Hi, ${name}`;\n");
  repo.write("gone.js", "x\n");
  repo.write("README.md", "# app\n");
  repo.commit("app");
  repo.write("greeting.js", "export const greet = (name) => `Hello, ${name}!`;\n");
  repo.write("greeting.test.js", "import test from 'node:test';\ntest('x', () => {});\n");
  repo.write(".octave/specs/greeting/notes.md", "## 1\n");
  repo.write(".pi/runs/1/check.log", "$ npm test\n");
  unlinkSync(join(repo.cwd, "gone.js"));

  const read = await readWorking(repo.cwd);
  assert.equal(read.truncated, false);
  const files = byPath(read);
  assert.deepEqual(Object.keys(files).sort(), [".octave/specs/greeting/notes.md", "gone.js", "greeting.js", "greeting.test.js"], "앱의 폴더는 없다");
  assert.deepEqual(files["greeting.js"], { path: "greeting.js", from: null, status: "modified", shown: "text", before: "export const greet = (name) => `Hi, ${name}`;\n", after: "export const greet = (name) => `Hello, ${name}!`;\n", added: 1, deleted: 1, spec: false });
  assert.deepEqual([files["greeting.test.js"].status, files["greeting.test.js"].before, files["greeting.test.js"].after, files["greeting.test.js"].added, files["greeting.test.js"].deleted], ["added", null, "import test from 'node:test';\ntest('x', () => {});\n", 2, 0], "git이 모르는 새 파일은 줄 전부가 새것");
  assert.deepEqual([files["gone.js"].status, files["gone.js"].before, files["gone.js"].after, files["gone.js"].deleted], ["deleted", "x\n", null, 1]);
  assert.equal(files[".octave/specs/greeting/notes.md"].spec, true);
  // Staged and unstaged alike: before is HEAD's, after is the disk's.
  repo.git("add", "greeting.js");
  repo.write("greeting.js", "export const greet = (name) => `Hello, ${name}!!`;\n");
  assert.equal(byPath(await readWorking(repo.cwd))["greeting.js"].after, "export const greet = (name) => `Hello, ${name}!!`;\n");
  // A staged rename is one; a binary is said to be.
  repo.git("mv", "README.md", "READ.md");
  repo.write("pic.png", Buffer.from([0x89, 0x50, 0, 0x47]));
  const moved = byPath(await readWorking(repo.cwd));
  assert.deepEqual([moved["READ.md"].status, moved["READ.md"].from], ["renamed", "README.md"]);
  assert.deepEqual([moved["pic.png"].shown, moved["pic.png"].added], ["binary", null]);
  // Nothing changed: nothing, not null. No repository: null.
  const clean = repository(t);
  clean.write("a", "a\n");
  clean.commit("a");
  assert.deepEqual(await readWorking(clean.cwd), { files: [], truncated: false });
  assert.equal(await readWorking(mkdtempSync(join(tmpdir(), "no-repo-"))), null);
});

test("status --porcelain -z, 읽기: 코드 둘과 경로, 옮긴 것은 새 이름 뒤에 옛 이름", () => {
  assert.deepEqual(statusIn(" M a.js\0?? b.js\0D  c.js\0R  new.md\0old.md\0A  d.js\0!! ignored\0"), [
    { status: "modified", path: "a.js", from: null },
    { status: "added", path: "b.js", from: null },
    { status: "deleted", path: "c.js", from: null },
    { status: "renamed", path: "new.md", from: "old.md" },
    { status: "added", path: "d.js", from: null },
  ]);
  assert.deepEqual(statusIn(""), []);
});
