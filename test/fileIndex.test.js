/**
 * 목록이 달라졌는가 — 색인이 대답해야 하는 유일한 질문.
 *
 * 서버는 이 답이 참일 때만 탭에 목록을 보낸다. 그러므로 "글자만 바뀐 저장"에 참을 돌려주면
 * 고친 것이 없는 것이고, 새 노트에 거짓을 돌려주면 노트가 안 보인다. 양쪽 다 물어본다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileIndex } from "../fileIndex.ts";

const vault = (...notes) => {
  const root = mkdtempSync(join(tmpdir(), "files-"));
  for (const path of notes) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), `# ${path}\n`);
  }
  return root;
};

test("폴더를 한 번 읽고, 다시 읽어도 달라진 것이 없으면 없다고 한다", () => {
  const root = vault("a.md", "ideas/b.md");
  try {
    const files = new FileIndex(root);
    assert.equal(files.load(), true, "처음 읽기는 빈 것에서 둘로 달라진 것이다");
    assert.deepEqual(files.paths().sort(), ["a.md", "ideas/b.md"]);
    assert.equal(files.load(), false, "그대로면 보낼 것이 없다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("글자만 바뀐 저장은 목록의 소식이 아니다 — 새 노트는 소식이다", () => {
  const root = vault("a.md");
  try {
    const files = new FileIndex(root);
    files.load();
    assert.equal(files.saw("a.md", 111), false, "있던 노트를 다시 쓴 것");
    assert.equal(files.saw("new.md", 222), true, "처음 보는 노트");
    assert.equal(files.paths().includes("new.md"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("지운 것과 이름 바꾼 것", () => {
  const root = vault("a.md", "b.md");
  try {
    const files = new FileIndex(root);
    files.load();
    assert.equal(files.remove("a.md"), true);
    assert.equal(files.remove("a.md"), false, "이미 없는 것을 지운 것은 소식이 아니다");
    assert.equal(files.rename("b.md", "ideas/c.md"), true);
    assert.deepEqual(files.paths(), ["ideas/c.md"]);
    assert.equal(files.has("b.md"), false);
    assert.equal(files.rename("nowhere.md", "d.md"), true, "몰랐던 노트가 새 이름으로 나타난 것도 소식이다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("바깥에서 나타나거나 사라진 것은 다시 읽어야 알고, 그때 달라졌다고 한다", () => {
  const root = vault("a.md");
  try {
    const files = new FileIndex(root);
    files.load();
    writeFileSync(join(root, "vim.md"), "# from vim\n");
    assert.equal(files.load(), true);
    assert.equal(files.has("vim.md"), true);
    unlinkSync(join(root, "vim.md"));
    assert.equal(files.load(), true);
    assert.equal(files.has("vim.md"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("목록은 최근에 쓴 것부터", () => {
  const root = vault("old.md", "new.md");
  try {
    const files = new FileIndex(root);
    files.load();
    files.saw("old.md", 1000);
    files.saw("new.md", 2000);
    assert.deepEqual(files.paths(), ["new.md", "old.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
