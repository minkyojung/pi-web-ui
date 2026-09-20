/**
 * 팔레트가 여는 목록이다. 빠지면 그 파일은 저장소에 있고 창에는 없으며, 넘치면 앱의
 * 것과 빌드 찌꺼기가 사람이 찾는 것을 밀어낸다. 양쪽 다 물어본다.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { repoFiles } from "../repoFiles.ts";

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" }).trim();

const write = (root, path, text) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};

const folder = () => mkdtempSync(join(tmpdir(), "repo-files-"));

test("추적 중인 것과 아직 커밋 안 된 것을 함께, 무시 목록과 앱의 폴더는 빼고", async () => {
  const root = folder();
  try {
    git(root, "init", "-q");
    write(root, ".gitignore", "node_modules/\ndist/\n");
    write(root, "server.ts", "// one\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "one");

    // 커밋 뒤에 생긴 것들: 에이전트가 방금 쓴 코드와 스펙의 문서가 이 자리에 있다.
    write(root, "web/App.tsx", "// two\n");
    write(root, ".octave/specs/email-auth/requirements.md", "# 요구사항\n");
    write(root, ".github/workflows/ci.yml", "on: push\n");
    write(root, "node_modules/left-pad/index.js", "module.exports = 1;\n");
    write(root, "dist/bundle.js", "1\n");
    write(root, ".pi/links.json", "{}\n");

    const repo = await repoFiles(root);
    assert.deepEqual(repo.files.sort(), [
      ".github/workflows/ci.yml",
      ".gitignore",
      ".octave/specs/email-auth/requirements.md",
      "server.ts",
      "web/App.tsx",
    ]);
    assert.equal(repo.truncated, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("저장소가 아닌 폴더에는 목록이 없다", async () => {
  const root = folder();
  try {
    write(root, "a.md", "# a\n");
    assert.equal(await repoFiles(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("이름이 한글이거나 줄바꿈이 든 파일도 디스크가 부르는 이름 그대로", async () => {
  const root = folder();
  try {
    git(root, "init", "-q");
    write(root, "회의록.md", "# 회의\n");
    write(root, "a\nb.txt", "odd\n");
    const repo = await repoFiles(root);
    assert.deepEqual(repo.files.sort(), ["a\nb.txt", "회의록.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("합치는 중이라 여러 단계로 올라온 파일도 이름 하나로만", async () => {
  const root = folder();
  try {
    git(root, "init", "-q");
    write(root, "a.txt", "base\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "other");
    write(root, "a.txt", "theirs\n");
    git(root, "commit", "-q", "-am", "theirs");
    git(root, "checkout", "-q", "main");
    write(root, "a.txt", "mine\n");
    git(root, "commit", "-q", "-am", "mine");
    try {
      git(root, "merge", "other");
    } catch {
      // 충돌이 이 검사의 목적이다.
    }
    const repo = await repoFiles(root);
    assert.deepEqual(repo.files, ["a.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
