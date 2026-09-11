import assert from "node:assert/strict";
import test from "node:test";

import { ChangeSet, Text } from "@codemirror/state";

import { changeSetOf, decide, hashForNote, noteFromHash, rebase, renameTarget, titleOf } from "../web/src/noteSync.ts";

const at = (text) => ({ text, modified: 1 });

test("내 저장의 메아리는 저장됨이고, 그 사이 더 쳤으면 아직 더러움", () => {
  assert.deepEqual(decide({ doc: "a", sent: "a", dirty: true }, at("a")), { kind: "saved", dirty: false });
  assert.deepEqual(decide({ doc: "ab", sent: "a", dirty: true }, at("a")), { kind: "saved", dirty: true });
});

test("같은 글이 다른 데서 오면 보여줄 것은 없다", () => {
  assert.deepEqual(decide({ doc: "a", sent: null, dirty: false }, at("a")), { kind: "same" });
});

test("안 친 상태에서 다른 글이 오면 그대로 보여준다 — pi가 고친 것", () => {
  assert.deepEqual(decide({ doc: "a", sent: null, dirty: false }, at("b")), { kind: "replace" });
});

test("치는 중에 다른 글이 오면 사람이 고른다", () => {
  assert.deepEqual(decide({ doc: "a typed", sent: null, dirty: true }, at("b")), { kind: "conflict" });
});

test("보낸 것과 다른 글이 오면 메아리가 아니다", () => {
  assert.deepEqual(decide({ doc: "a", sent: "a", dirty: true }, at("z")), { kind: "conflict" });
});

test("주소에서 노트를 읽고, 노트로 주소를 만든다", () => {
  assert.equal(noteFromHash("#a.md"), "a.md");
  assert.equal(noteFromHash("#ideas/second.md"), "ideas/second.md");
  assert.equal(noteFromHash("#my%20note.md"), "my note.md");
  assert.equal(noteFromHash("#"), null);
  assert.equal(noteFromHash(""), null);
  assert.equal(noteFromHash("#today"), null);
  assert.equal(noteFromHash("#%E0%A4%A"), null, "깨진 인코딩은 아무것도 아니다");
  assert.equal(hashForNote("ideas/my note.md"), "#ideas/my%20note.md");
  assert.equal(noteFromHash(hashForNote("한글 노트/a b.md")), "한글 노트/a b.md");
});

const applyTo = (text, set) => set.apply(Text.of(text.split("\n"))).toString();
const edit = (base, from, to, insert) => ChangeSet.of({ from, to, insert }, base.length);

test("서버의 변경들은 순서대로 접혀 한 변경이 되고, 적용하면 그 글이 된다", () => {
  const base = "one two three";
  const changes = [
    { from: 4, to: 7, inserted: "2", removed: "two" },
    { from: 6, to: 11, inserted: "3", removed: "three" },
  ];
  assert.equal(applyTo(base, changeSetOf(changes, base.length)), "one 2 3");
  assert.equal(applyTo(base, changeSetOf([], base.length)), base);
});

test("겹치지 않는 두 편집은 서로 자리를 옮겨 둘 다 남는다", () => {
  const base = "alpha beta gamma";
  const theirs = edit(base, 0, 5, "ALPHA");      // pi changes the first word
  const ours = edit(base, 11, 16, "GAMMA");      // I change the last, unsaved
  const fit = rebase(theirs, ours);
  assert.ok(fit);
  const screen = applyTo(base, ours);
  assert.equal(applyTo(screen, fit.theirs), "ALPHA beta GAMMA", "그들의 변경을 내 화면에");
  const server = applyTo(base, theirs);
  assert.equal(applyTo(server, fit.ours), "ALPHA beta GAMMA", "내 변경을 그들의 글에 — 다음 저장의 기준");
});

test("앞쪽에 넣은 글 때문에 뒤가 밀려도 맞게 옮겨진다", () => {
  const base = "ab";
  const theirs = edit(base, 0, 0, "XX");
  const ours = edit(base, 2, 2, "YY");
  const fit = rebase(theirs, ours);
  assert.equal(applyTo(applyTo(base, ours), fit.theirs), "XXabYY");
  assert.equal(applyTo(applyTo(base, theirs), fit.ours), "XXabYY");
});

test("같은 글을 건드리면 맞출 수 없다", () => {
  const base = "alpha beta gamma";
  assert.equal(rebase(edit(base, 0, 5, "A"), edit(base, 2, 8, "X")), null);
  assert.equal(rebase(edit(base, 6, 10, "B"), edit(base, 6, 10, "b")), null, "같은 단어");
  assert.ok(rebase(edit(base, 6, 10, "B"), edit(base, 16, 16, "!")), "끝에 덧붙이는 것은 겹치지 않는다");
});

test("제목은 폴더와 확장자를 뺀 파일명이다", () => {
  assert.equal(titleOf("Untitled.md"), "Untitled");
  assert.equal(titleOf("ideas/my note.md"), "my note");
  assert.equal(titleOf("a/b/c.md"), "c");
});

test("제목을 바꾸면 같은 폴더에 그 이름의 .md가 되고, 안 되는 이름은 요청 전에 거절된다", () => {
  assert.deepEqual(renameTarget("ideas/old.md", "new name"), { to: "ideas/new name.md" });
  assert.deepEqual(renameTarget("old.md", "  spaced  "), { to: "spaced.md" });
  assert.deepEqual(renameTarget("old.md", "한글 제목"), { to: "한글 제목.md" });
  assert.ok("error" in renameTarget("old.md", ""));
  assert.ok("error" in renameTarget("old.md", "   "));
  assert.ok("error" in renameTarget("old.md", ".hidden"));
  assert.ok("error" in renameTarget("old.md", "name.md"));
  assert.ok("error" in renameTarget("old.md", "a\\b"));
});

test("제목의 슬래시는 폴더다 — 앞에 있으면 맨 위에서, 없으면 노트의 폴더에서", () => {
  assert.deepEqual(renameTarget("old.md", "ideas/moved"), { to: "ideas/moved.md" }, "하위로");
  assert.deepEqual(renameTarget("ideas/old.md", "sub/moved"), { to: "ideas/sub/moved.md" }, "노트의 폴더에서");
  assert.deepEqual(renameTarget("ideas/sub/old.md", "/moved"), { to: "moved.md" }, "루트로");
  assert.deepEqual(renameTarget("ideas/old.md", "/archive/2026/moved"), { to: "archive/2026/moved.md" });
  assert.deepEqual(renameTarget("old.md", " ideas / moved "), { to: "ideas/moved.md" }, "부분마다 앞뒤 공백이 떨어진다");
  for (const name of ["../out", "ideas/../out", "/..", "ideas/..", "a//b", "ideas/", "/", "//a", "ideas/.hidden", ".git/x", "ideas/name.md"]) {
    assert.ok("error" in renameTarget("ideas/old.md", name), name);
  }
});
