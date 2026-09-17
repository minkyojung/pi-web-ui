import assert from "node:assert/strict";
import test from "node:test";

import { foldersOf, reveal, toggle, treeOf } from "../web/src/tree.ts";

test("경로들은 폴더가 먼저, 그 다음 노트가, 각각 이름순으로 선 트리가 된다", () => {
  assert.deepEqual(treeOf(["zed.md", "ideas/second.md", "a.md", "ideas/first.md", "b/c/deep.md"]), [
    {
      kind: "folder",
      name: "b",
      path: "b",
      children: [{ kind: "folder", name: "c", path: "b/c", children: [{ kind: "file", name: "deep.md", path: "b/c/deep.md" }] }],
    },
    {
      kind: "folder",
      name: "ideas",
      path: "ideas",
      children: [
        { kind: "file", name: "first.md", path: "ideas/first.md" },
        { kind: "file", name: "second.md", path: "ideas/second.md" },
      ],
    },
    { kind: "file", name: "a.md", path: "a.md" },
    { kind: "file", name: "zed.md", path: "zed.md" },
  ]);
});

test("이름의 숫자는 숫자로 세고, 빈 목록은 빈 트리다", () => {
  assert.deepEqual(
    treeOf(["10.md", "2.md"]).map((n) => n.name),
    ["2.md", "10.md"],
  );
  assert.deepEqual(treeOf([]), []);
});

test("노트가 든 폴더는 바깥부터 안쪽 순서다", () => {
  assert.deepEqual(foldersOf("a/b/c.md"), ["a", "a/b"]);
  assert.deepEqual(foldersOf("top.md"), []);
});

test("노트를 열면 그 폴더들이 열리고, 이미 열려 있으면 같은 집합이 돌아온다", () => {
  const open = new Set(["x"]);
  assert.deepEqual([...reveal(open, "a/b/c.md")].sort(), ["a", "a/b", "x"]);
  assert.equal(reveal(open, "top.md"), open);
  const already = new Set(["a", "a/b"]);
  assert.equal(reveal(already, "a/b/c.md"), already);
});

test("폴더는 닫혀 있으면 열리고 열려 있으면 닫힌다", () => {
  const open = new Set(["a"]);
  assert.deepEqual([...toggle(open, "b")].sort(), ["a", "b"]);
  assert.deepEqual([...toggle(open, "a")], []);
  assert.deepEqual([...open], ["a"], "원래 집합은 그대로다");
});
