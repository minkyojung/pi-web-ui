import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CODE_MAX, codeAt, documentAt, listFiles, listNotes, newNoteName, notePath, readCode, readNote, readSpec, renameNote, resolveNote, restoreNote, specAt, specRecordAt, trashNote, withCreated, writeNote, writeSpec } from "../vault.ts";
import { isSpec, isSpecRecord, specNameOf } from "../documentKinds.ts";

const DIR = mkdtempSync(join(tmpdir(), "notes-"));
/** What the disk calls DIR: on a Mac the temp folder is reached through a symlink. */
const REAL = realpathSync.native(DIR);
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

test("문서는 노트 곁에, 같은 걸음으로, 경로만 이름순으로", () => {
  put("paper.pdf", 50);
  put("papers/Deep.PDF", 60);
  put(".pi/cache.pdf", 70);
  const { notes, documents } = listFiles(DIR);
  assert.deepEqual(documents, ["paper.pdf", "papers/Deep.PDF"]);
  assert.ok(notes.every((f) => f.path.endsWith(".md")), "노트 목록에 문서는 없다");
  assert.deepEqual(listNotes(DIR), notes);
  assert.equal(documentAt(DIR, "papers/Deep.PDF"), "papers/Deep.PDF");
  assert.equal(documentAt(DIR, ".pi/cache.pdf"), null, "숨김 폴더는 아니다");
  assert.equal(documentAt(DIR, "a.md"), null, "노트는 문서가 아니다");
  assert.equal(documentAt(DIR, "../x.pdf"), null);
  assert.equal(documentAt(DIR, join(DIR, "paper.pdf")), null, "절대 경로는 폴더 이름이 아니다");
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
  assert.equal(resolveNote(DIR, "a.md"), join(REAL, "a.md"));
  assert.equal(resolveNote(DIR, "deep/er/c.md"), join(REAL, "deep/er/c.md"));
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
  assert.deepEqual(writeNote(DIR, "new/other.md", "x", 12345), { ok: false, reason: "missing" }, "있던 노트가 없어졌다");
  assert.deepEqual(writeNote(DIR, "../out.md", "x", null), { ok: false, reason: "invalid" });
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

test("새 노트는 Untitled이고, 있으면 번호가 붙는다", () => {
  assert.equal(newNoteName([]), "Untitled.md");
  assert.equal(newNoteName(["Untitled.md"]), "Untitled 2.md");
  assert.equal(newNoteName(["Untitled.md", "Untitled 2.md"]), "Untitled 3.md");
  assert.equal(newNoteName(["Untitled.md", "Untitled 3.md"]), "Untitled 2.md", "빈 번호가 먼저");
  assert.equal(newNoteName(["deep/Untitled.md"]), "Untitled.md", "다른 폴더의 같은 이름은 다른 노트");
});

test("이름을 바꾸면 파일이 옮겨지고 내용과 시각은 그대로다", () => {
  put("ren/old.md", 950);
  const before = readNote(DIR, "ren/old.md");
  assert.deepEqual(renameNote(DIR, "ren/old.md", "ren/sub/new.md"), { ok: true });
  assert.equal(readNote(DIR, "ren/old.md"), null);
  const after = readNote(DIR, "ren/sub/new.md");
  assert.equal(after.text, before.text);
  assert.equal(after.modified, before.modified, "옮기는 것은 쓰는 것이 아니다");
});

test("없는 노트, 이미 있는 이름, 노트가 아닌 이름으로는 바꿀 수 없다", () => {
  put("ren/a.md", 1);
  put("ren/b.md", 1);
  assert.deepEqual(renameNote(DIR, "ren/nope.md", "ren/x.md"), { ok: false, reason: "missing" });
  assert.deepEqual(renameNote(DIR, "ren/a.md", "ren/b.md"), { ok: false, reason: "exists" });
  assert.deepEqual(renameNote(DIR, "ren/a.md", "../a.md"), { ok: false, reason: "invalid" });
  assert.deepEqual(renameNote(DIR, "ren/a.md", "ren/a.txt"), { ok: false, reason: "invalid" });
  assert.deepEqual(renameNote(DIR, "ren/a.md", "ren/a.md"), { ok: true }, "같은 이름은 아무 일도 아니다");
  assert.ok(readNote(DIR, "ren/a.md") && readNote(DIR, "ren/b.md"), "거절은 아무것도 옮기지 않는다");
});

test("지우면 휴지통으로 가고 목록에서 사라지며, 되살리면 돌아온다", () => {
  put("gone/x.md", 1);
  const r = trashNote(DIR, "gone/x.md");
  assert.deepEqual(r, { ok: true, trashed: "gone/x.md" });
  assert.equal(readNote(DIR, "gone/x.md"), null);
  assert.equal(readFileSync(join(DIR, ".pi/trash/notes/gone/x.md"), "utf8"), "# note\n");
  assert.ok(!listNotes(DIR).some((f) => f.path.includes("trash")), "휴지통은 노트가 아니다");
  assert.deepEqual(restoreNote(DIR, "gone/x.md", "gone/x.md"), { ok: true });
  assert.equal(readNote(DIR, "gone/x.md").text, "# note\n");
});

test("같은 이름을 두 번 지우면 둘 다 남고, 되살릴 자리가 차 있으면 거절된다", () => {
  put("twice.md", 1);
  trashNote(DIR, "twice.md");
  put("twice.md", 2);
  const second = trashNote(DIR, "twice.md", new Date(Date.UTC(2026, 8, 11, 1, 2, 3)));
  assert.equal(second.ok, true);
  assert.equal(second.trashed, "twice 2026-09-11T01-02-03-000Z.md");
  assert.deepEqual(restoreNote(DIR, "twice.md", "twice.md"), { ok: true });
  assert.deepEqual(restoreNote(DIR, second.trashed, "twice.md"), { ok: false, reason: "exists" }, "자리가 차 있다");
  assert.deepEqual(trashNote(DIR, "nope.md"), { ok: false, reason: "missing" });
  assert.deepEqual(trashNote(DIR, "../x.md"), { ok: false, reason: "invalid" });
  assert.deepEqual(restoreNote(DIR, "never.md", "never.md"), { ok: false, reason: "missing" });
});

// --- one note, however its name is spelled ---
//
// What a file system treats as the same name is its own business and differs
// between them, so each of these asks the disk under the test whether it has
// the behaviour at all, the way git probes for core.ignorecase. Where it does
// not, there is nothing to get wrong and the case is skipped.

const opens = (name, as) => {
  writeFileSync(join(DIR, name), "probe\n");
  try {
    readFileSync(join(DIR, as));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(join(DIR, name), { force: true });
  }
};

const NFC = "café.md".normalize("NFC");
const NFD = "café.md".normalize("NFD");

test("대문자로 쓴 확장자도 같은 노트다 — 파일시스템이 같은 파일을 열어 준다면", (t) => {
  if (!opens("case.md", "case.MD")) return t.skip("대소문자를 구분하는 파일시스템");
  writeFileSync(join(DIR, "case.md"), "mine\n");
  t.after(() => rmSync(join(DIR, "case.md"), { force: true }));
  assert.equal(notePath(DIR, "case.MD"), "case.md", "디스크가 부르는 이름으로 돌아온다");
  assert.equal(readNote(DIR, "case.MD").path, "case.md");
  assert.equal(readNote(DIR, "case.MD").text, "mine\n");
});

test("아직 없는 노트를 .MD로 만들려는 것은 노트가 아니다 — 목록에 뜨지 않을 이름이라서", () => {
  assert.equal(notePath(DIR, "notmade.MD"), null);
});

test("한글과 악센트는 어떻게 조합되어 있든 같은 노트다", (t) => {
  if (!opens(NFC, NFD)) return t.skip("정규화를 가리는 파일시스템");
  writeFileSync(join(DIR, NFC), "mine\n");
  t.after(() => rmSync(join(DIR, NFC), { force: true }));
  const listed = listNotes(DIR).find((f) => f.path.normalize("NFC") === NFC);
  assert.ok(listed, "목록에는 디스크 철자로 뜬다");
  assert.equal(notePath(DIR, NFD), listed.path, "다르게 조합해 물어도 그 하나를 가리킨다");
  assert.equal(notePath(DIR, NFC), listed.path);
});

test("pi가 절대 경로로 말해도 폴더 기준 이름으로 돌아온다", () => {
  assert.equal(notePath(DIR, join(DIR, "a.md")), "a.md");
  assert.equal(notePath(DIR, join(REAL, "deep/er/c.md")), "deep/er/c.md");
  assert.equal(notePath(DIR, join(DIR, "..", "outside.md")), null);
});

test("폴더 밖을 가리키는 심볼릭 링크는 노트가 아니다 — 글자만 봐서는 알 수 없는 것", (t) => {
  const link = join(DIR, "escape.md");
  const outside = join(tmpdir(), `vault-escape-${process.pid}.md`);
  writeFileSync(outside, "not yours\n");
  try {
    symlinkSync(outside, link);
  } catch {
    return t.skip("심볼릭 링크를 만들 수 없는 곳");
  }
  t.after(() => {
    rmSync(link, { force: true });
    rmSync(outside, { force: true });
  });
  assert.equal(notePath(DIR, "escape.md"), null);
  assert.equal(readNote(DIR, "escape.md"), null);
});

// --- what a note says the moment it is made ---

const AT = new Date(2026, 0, 1, 0, 5); // 새해 0시 5분, 이곳의 시각으로

test("새 노트는 만들어진 시각을 적는다 — 지역 시각으로, 분까지", () => {
  assert.equal(withCreated("", AT), "---\ncreated: 2026-01-01T00:05\n---\n");
});

test("UTC로 바꾸지 않는다 — 자정 근처에서 날짜가 하루 어긋나지 않도록", () => {
  // toISOString이라면 서울에서 2025-12-31T15:05Z가 되어 전날이 된다.
  assert.match(withCreated("", AT), /2026-01-01T00:05/);
});

test("이미 속성이 있으면 그 줄들은 그대로 두고 한 줄만 더한다", () => {
  assert.equal(withCreated("---\ntags: [a]   # kept\n---\nbody\n", AT), "---\ntags: [a]   # kept\ncreated: 2026-01-01T00:05\n---\nbody\n");
});

test("이미 만들어진 시각을 말하는 노트는 그대로 둔다", () => {
  const note = "---\ncreated: 2020-05-05T09:00\n---\nbody\n";
  assert.equal(withCreated(note, AT), note);
});

test("깨진 블록은 건드리지 않는다", () => {
  const note = "---\ntags: [a\n---\nbody\n";
  assert.equal(withCreated(note, AT), note);
});

// --- the agent's specs: markdown under .octave/specs/, beside the notes and not among them ---

test("이름만 보고도 스펙인지 안다 — .octave/specs/ 아래의 마크다운", () => {
  assert.equal(isSpec(".octave/specs/email-auth/requirements.md"), true);
  assert.equal(isSpec(".octave/specs/a.md"), true);
  assert.equal(isSpec("a.md"), false, "노트는 스펙이 아니다");
  assert.equal(isSpec(".octave/a.md"), false, "specs/ 밖");
  assert.equal(isSpec(".octave/specs/x/requirements.txt"), false);
  assert.equal(isSpec(".octave/specs/x/requirements.MD"), false, "노트처럼, 디스크 철자가 .md여야");
  assert.equal(isSpec(".octave/specs/x/.draft.md"), false, "그 아래의 숨김 파일");
  assert.equal(isSpec("docs/.octave/specs/x.md"), false, "폴더의 맨 위에서만");
});

test("어느 스펙의 것인지도 이름으로 안다", () => {
  assert.equal(specNameOf(".octave/specs/email-auth/requirements.md"), "email-auth");
  assert.equal(specNameOf(".octave/specs/email-auth/approvals.json"), "email-auth", "문서가 아니어도 그 스펙의 것이다");
  assert.equal(specNameOf(".octave/specs/email-auth/notes/draft.md"), "email-auth", "더 깊어도 그 스펙 아래다");
  assert.equal(specNameOf(".octave/specs/a.md"), null, "스펙 폴더가 아니라 specs/ 바로 아래의 파일");
  assert.equal(specNameOf(".octave/specs/.hidden/requirements.md"), null, "숨김 폴더는 아무것도 아니다");
  assert.equal(specNameOf("a.md"), null);
});

test("승인 기록도 폴더 안에 있을 때만 그것이다", () => {
  put(".octave/specs/email-auth/approvals.json", 100);
  assert.equal(specRecordAt(DIR, ".octave/specs/email-auth/approvals.json")?.path, ".octave/specs/email-auth/approvals.json");
  assert.equal(specRecordAt(DIR, ".octave/specs/email-auth/requirements.md"), null, "문서는 기록이 아니다");
  assert.equal(specRecordAt(DIR, "../.octave/specs/x/approvals.json"), null, "폴더 밖");
  assert.equal(specRecordAt(DIR, join(DIR, ".octave/specs/email-auth/approvals.json")), null, "폴더 기준 이름으로만");
});

test("승인 기록은 스펙 폴더 바로 안의 approvals.json 하나다", () => {
  assert.equal(isSpecRecord(".octave/specs/email-auth/approvals.json"), true);
  assert.equal(isSpecRecord(".octave/specs/email-auth/requirements.md"), false, "문서는 기록이 아니다");
  assert.equal(isSpecRecord(".octave/specs/approvals.json"), false, "스펙 폴더 안에서만");
  assert.equal(isSpecRecord(".octave/specs/x/deep/approvals.json"), false, "폴더 바로 안에서만");
  assert.equal(isSpecRecord("approvals.json"), false);
});

test("스펙은 폴더 안의 .octave/specs/ 아래 마크다운이고, 노트가 아니다", () => {
  put(".octave/specs/email-auth/requirements.md", 100);
  put(".octave/notes.md", 100);
  const spec = specAt(DIR, ".octave/specs/email-auth/requirements.md");
  assert.deepEqual(spec, { path: ".octave/specs/email-auth/requirements.md", full: join(REAL, ".octave/specs/email-auth/requirements.md") });
  assert.equal(notePath(DIR, ".octave/specs/email-auth/requirements.md"), null, "노트의 문은 여전히 점 폴더를 못 본다");
  assert.ok(!listNotes(DIR).some((f) => f.path.startsWith(".octave")), "노트 목록에 들지 않는다");
  assert.equal(specAt(DIR, ".octave/notes.md"), null, "specs/ 밖");
  assert.equal(specAt(DIR, "a.md"), null, "노트는 스펙이 아니다");
  assert.equal(specAt(DIR, "../.octave/specs/x.md"), null, "폴더 밖");
  assert.equal(specAt(DIR, ".octave/specs/../../a.md"), null, "..로 나가면 그곳이다");
  assert.equal(specAt(DIR, join(DIR, ".octave/specs/email-auth/requirements.md")), null, "노트처럼 폴더 기준 이름으로만");
  assert.equal(specAt(DIR, ""), null);
});

test("스펙 자리로 가는 심볼릭 링크는 디스크가 가리키는 곳으로 판정한다 — 노트면 노트, 밖이면 아무것도 아니다", (t) => {
  put("linked.md", 100);
  mkdirSync(join(DIR, ".octave/specs"), { recursive: true });
  const toNote = join(DIR, ".octave/specs/note.md");
  const outside = mkdtempSync(join(tmpdir(), "vault-spec-outside-"));
  writeFileSync(join(outside, "x.md"), "not yours\n");
  try {
    symlinkSync(join(DIR, "linked.md"), toNote);
    symlinkSync(outside, join(DIR, ".octave/specs/away"));
  } catch {
    return t.skip("심볼릭 링크를 만들 수 없는 곳");
  }
  t.after(() => {
    rmSync(toNote, { force: true });
    rmSync(join(DIR, ".octave/specs/away"), { force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  assert.equal(specAt(DIR, ".octave/specs/note.md"), null, "노트를 가리키면 스펙이 아니고");
  assert.equal(notePath(DIR, ".octave/specs/note.md"), "linked.md", "그 노트다 — 한 파일이 둘일 수는 없다");
  assert.equal(specAt(DIR, ".octave/specs/away/x.md"), null, "폴더 밖을 가리키면 아무것도 아니다");
});

test("디스크가 같은 이름으로 여는 철자는 디스크 철자의 스펙으로 돌아온다", (t) => {
  if (!opens("probe.md", "PROBE.md")) return t.skip("대소문자를 구분하는 파일시스템");
  put(".octave/specs/case/requirements.md", 100);
  assert.equal(specAt(DIR, ".Octave/Specs/case/requirements.md")?.path, ".octave/specs/case/requirements.md");
});

test("스펙은 읽은 시각 위에 쓰이고, 그 사이 바뀌었거나 사라졌으면 거절된다 — 노트와 같은 약속", () => {
  put(".octave/specs/rw/requirements.md", 100);
  const first = readSpec(DIR, ".octave/specs/rw/requirements.md");
  assert.deepEqual(first, { path: ".octave/specs/rw/requirements.md", text: "# note\n", modified: 100_000 });
  const ok = writeSpec(DIR, ".octave/specs/rw/requirements.md", "mine\n", first.modified);
  assert.equal(ok.ok, true);
  assert.equal(readFileSync(join(DIR, ".octave/specs/rw/requirements.md"), "utf8"), "mine\n");
  // The agent writes in between.
  writeFileSync(join(DIR, ".octave/specs/rw/requirements.md"), "theirs\n");
  utimesSync(join(DIR, ".octave/specs/rw/requirements.md"), 900, 900);
  assert.deepEqual(writeSpec(DIR, ".octave/specs/rw/requirements.md", "mine again\n", ok.modified), { ok: false, reason: "conflict", modified: 900_000 });
  assert.equal(readFileSync(join(DIR, ".octave/specs/rw/requirements.md"), "utf8"), "theirs\n", "거절은 아무것도 쓰지 않는다");
  rmSync(join(DIR, ".octave/specs/rw/requirements.md"));
  assert.deepEqual(writeSpec(DIR, ".octave/specs/rw/requirements.md", "x", 900_000), { ok: false, reason: "missing" });
  assert.equal(readSpec(DIR, ".octave/specs/rw/requirements.md"), null);
  assert.equal(writeSpec(DIR, ".octave/specs/new/requirements.md", "back\n", null).ok, true, "없던 것은 base가 null일 때만, 폴더도 같이");
  assert.equal(readFileSync(join(DIR, ".octave/specs/new/requirements.md"), "utf8"), "back\n");
});

test("스펙의 문과 노트의 문은 서로를 열지 않는다", () => {
  put(".octave/specs/doors/requirements.md", 100);
  put("doors.md", 100);
  assert.deepEqual(writeSpec(DIR, "doors.md", "x", 100_000), { ok: false, reason: "invalid" });
  assert.deepEqual(writeNote(DIR, ".octave/specs/doors/requirements.md", "x", 100_000), { ok: false, reason: "invalid" });
  assert.equal(readSpec(DIR, "doors.md"), null);
  assert.equal(readNote(DIR, ".octave/specs/doors/requirements.md"), null);
  assert.equal(readFileSync(join(DIR, "doors.md"), "utf8"), "# note\n");
  assert.equal(readFileSync(join(DIR, ".octave/specs/doors/requirements.md"), "utf8"), "# note\n");
});

test("코드의 문은 저장소의 아무 파일이나 열고, .git과 .pi만 거절한다", () => {
  put("server.ts", 100);
  put(".github/workflows/ci.yml", 100);
  put(".octave/specs/doors/design.md", 100);
  put(".git/config", 100);
  put(".pi/links.json", 100);
  put("deep/.git/HEAD", 100);
  assert.equal(codeAt(DIR, "server.ts").path, "server.ts");
  assert.equal(codeAt(DIR, ".github/workflows/ci.yml").path, ".github/workflows/ci.yml", "저장소의 점 폴더는 저장소의 것이다");
  assert.equal(codeAt(DIR, ".octave/specs/doors/design.md").path, ".octave/specs/doors/design.md");
  assert.equal(codeAt(DIR, ".git/config"), null);
  assert.equal(codeAt(DIR, "deep/.git/HEAD"), null, "깊은 곳의 .git도 git의 것이다");
  assert.equal(codeAt(DIR, ".pi/links.json"), null);
  put(".pi/runs/dev.log", 100);
  put(".pi/runs/3/unit.log", 100);
  assert.equal(codeAt(DIR, ".pi/runs/dev.log").path, ".pi/runs/dev.log", "명령이 찍은 것은 읽으라고 남긴 것이다");
  assert.equal(codeAt(DIR, ".pi/runs/3/unit.log").path, ".pi/runs/3/unit.log");
  assert.equal(codeAt(DIR, ".pi/runs/../settings.json"), null, "runs를 거쳐 나가는 길은 없다");
  assert.equal(codeAt(DIR, ".pi/trash/x.md"), null);
  assert.equal(codeAt(DIR, "../outside.ts"), null, "폴더 밖은 폴더 밖이다");
  assert.equal(codeAt(DIR, join(DIR, "server.ts")), null, "절대 경로로는 부르지 않는다");
});

test("읽기는 글자와 쓰인 시각을 주고, 글자가 아닌 것은 그렇다고 말한다", () => {
  writeFileSync(join(DIR, "read-me.ts"), "const a = 1;\n");
  utimesSync(join(DIR, "read-me.ts"), 400, 400);
  assert.deepEqual(readCode(DIR, "read-me.ts"), { ok: true, path: "read-me.ts", text: "const a = 1;\n", modified: 400_000, truncated: false });
  assert.deepEqual(readCode(DIR, "nothing-here.ts"), { ok: false, reason: "missing" });
  assert.deepEqual(readCode(DIR, ".git/config"), { ok: false, reason: "missing" }, "거절은 없는 것과 같이 말한다");

  writeFileSync(join(DIR, "picture.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]));
  assert.deepEqual(readCode(DIR, "picture.png"), { ok: false, reason: "binary" });

  writeFileSync(join(DIR, "long.txt"), "x".repeat(CODE_MAX + 10));
  const long = readCode(DIR, "long.txt");
  assert.equal(long.ok, true);
  assert.equal(long.text.length, CODE_MAX);
  assert.equal(long.truncated, true);
});
