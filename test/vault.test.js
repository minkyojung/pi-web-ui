import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { listNotes, readNote, resolveNote, writeNote } from "../vault.ts";

const DIR = mkdtempSync(join(tmpdir(), "notes-"));
test.after(() => rmSync(DIR, { recursive: true, force: true }));

const put = (path, whenSeconds) => {
  const full = join(DIR, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "# note\n");
  utimesSync(full, whenSeconds, whenSeconds);
};

test("마크다운만, 하위 폴더까지, 최근 것이 먼저", () => {
  put("b.md", 200);
  put("a.md", 300);
  put("deep/er/c.md", 100);
  put("notes.txt", 400);
  put("code.ts", 400);
  assert.deepEqual(
    listNotes(DIR).map((f) => f.path),
    ["a.md", "b.md", "deep/er/c.md"],
  );
});

test("숨김 폴더와 의존성 폴더는 들어가지 않는다", () => {
  put(".git/x.md", 500);
  put(".pi/sessions/y.md", 500);
  put("node_modules/pkg/README.md", 500);
  assert.ok(listNotes(DIR).every((f) => !f.path.includes("node_modules") && !f.path.startsWith(".")));
});

test("같은 시각이면 이름순이라 목록이 흔들리지 않는다", () => {
  put("same/z.md", 50);
  put("same/y.md", 50);
  const same = listNotes(DIR).filter((f) => f.path.startsWith("same/")).map((f) => f.path);
  assert.deepEqual(same, ["same/y.md", "same/z.md"]);
});

test("없는 폴더는 빈 목록이다", () => {
  assert.deepEqual(listNotes(join(DIR, "nope")), []);
});

test("폴더 밖, 절대 경로, 숨김 폴더, 마크다운 아닌 것은 노트가 아니다", () => {
  assert.equal(resolveNote(DIR, "a.md"), join(DIR, "a.md"));
  assert.equal(resolveNote(DIR, "deep/er/c.md"), join(DIR, "deep/er/c.md"));
  assert.equal(resolveNote(DIR, "../a.md"), null);
  assert.equal(resolveNote(DIR, "deep/../../a.md"), null);
  assert.equal(resolveNote(DIR, join(DIR, "a.md")), null, "절대 경로는 상대 경로로만 받는다");
  assert.equal(resolveNote(DIR, ".pi/x.md"), null);
  assert.equal(resolveNote(DIR, "notes.txt"), null);
  assert.equal(resolveNote(DIR, ""), null);
});

test("읽으면 본문과 쓰인 시각이 온다", () => {
  put("read/me.md", 700);
  const note = readNote(DIR, "read/me.md");
  assert.equal(note.text, "# note\n");
  assert.equal(note.modified, 700_000);
  assert.equal(readNote(DIR, "read/nope.md"), null);
  assert.equal(readNote(DIR, "../etc.md"), null);
});

test("없던 노트는 base가 null일 때만 만들어지고, 폴더도 같이 생긴다", () => {
  const r = writeNote(DIR, "new/dir/note.md", "hi\n", null);
  assert.equal(r.ok, true);
  assert.equal(readFileSync(join(DIR, "new/dir/note.md"), "utf8"), "hi\n");
  assert.equal(r.modified, readNote(DIR, "new/dir/note.md").modified);
  assert.deepEqual(writeNote(DIR, "new/other.md", "x", 12345), { ok: false, reason: "invalid" });
  assert.equal(existsSync(join(DIR, "new/other.md")), false);
});

test("읽은 시각 위에 쓰면 되고, 그 사이 바뀐 파일에는 거절된다", () => {
  put("guard.md", 800);
  const first = readNote(DIR, "guard.md");
  const ok = writeNote(DIR, "guard.md", "mine\n", first.modified);
  assert.equal(ok.ok, true);
  assert.equal(readFileSync(join(DIR, "guard.md"), "utf8"), "mine\n");
  // pi, or anyone, writes in between.
  writeFileSync(join(DIR, "guard.md"), "theirs\n");
  utimesSync(join(DIR, "guard.md"), 900, 900);
  const late = writeNote(DIR, "guard.md", "mine again\n", ok.modified);
  assert.deepEqual(late, { ok: false, reason: "conflict", modified: 900_000 });
  assert.equal(readFileSync(join(DIR, "guard.md"), "utf8"), "theirs\n", "거절은 아무것도 쓰지 않는다");
});

test("임시 파일을 남기지 않는다", () => {
  writeNote(DIR, "tmp.md", "x\n", null);
  const leftovers = listNotes(DIR).filter((f) => f.path.includes(".tmp"));
  assert.deepEqual(leftovers, []);
  assert.equal(existsSync(join(DIR, `tmp.md.${process.pid}.tmp`)), false);
});
