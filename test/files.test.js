import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { listNotes } from "../files.ts";

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
