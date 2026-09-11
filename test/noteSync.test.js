import assert from "node:assert/strict";
import test from "node:test";

import { decide, hashForNote, noteFromHash } from "../web/src/noteSync.ts";

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
