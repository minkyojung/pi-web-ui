import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasWall, profileFor, quoted, walled, writeProfile } from "../wall.ts";

test("한 낱말로 인용된다 — 따옴표도, 개행도, 달러도 그대로", () => {
  assert.equal(quoted("echo hi"), "'echo hi'");
  assert.equal(quoted("it's"), `'it'\\''s'`);
  const tricky = `printf '%s\\n' "$HOME" 'a b' && echo $(date)`;
  assert.equal(execFileSync("/bin/bash", ["-c", `echo ${quoted(tricky)}`], { encoding: "utf8" }).trimEnd(), tricky, "셸을 한 번 지나도 같은 글자");
});

test("프로파일은 폴더의 노트와 .pi만 막고, 경로의 특수문자는 글자로 읽힌다", () => {
  const profile = profileFor("/Users/a.b/My Notes (2026)");
  assert.match(profile, /\(allow default\)/);
  assert.ok(profile.includes(`(regex #"^/Users/a\\.b/My Notes \\(2026\\)/.*\\.[mM][dD]$")`), profile);
  assert.ok(profile.includes(`(subpath "/Users/a.b/My Notes (2026)/.pi")`), profile);
});

test("프로파일은 .octave를 노트 규칙 뒤에서 열고, .pi는 그 뒤에서 다시 닫는다 — 마지막에 맞은 규칙이 이긴다", () => {
  const profile = profileFor("/v");
  const notes = profile.indexOf("(deny file-write* (regex");
  const octave = profile.indexOf(`(allow file-write* (subpath "/v/.octave"))`);
  const app = profile.indexOf(`(deny file-write* (subpath "/v/.pi"))`);
  assert.ok(notes !== -1 && octave !== -1 && app !== -1, profile);
  assert.ok(notes < octave && octave < app, profile);
});

test("감싼 명령은 sandbox-exec 아래의 bash로 간다", () => {
  assert.equal(walled("ls -la", "/p/x.sb"), "exec /usr/bin/sandbox-exec -f '/p/x.sb' /bin/bash -c 'ls -la'");
});

// The wall itself, where there is one to test. Each command is run the way pi
// runs a bash call — `/bin/bash -c <command>` — with the command walled first.
test("벽 뒤에서는 노트를 쓸 수 없고, 읽을 수 있고, 다른 파일은 쓸 수 있다", { skip: !hasWall() && "sandbox-exec가 없는 곳" }, () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "wall test ")));
  const appDir = mkdtempSync(join(tmpdir(), "wall-app-"));
  process.env.APP_DIR = appDir;
  try {
    writeFileSync(join(dir, "a.md"), "note\n");
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi/keep"), "x");
    const profile = writeProfile(dir);
    assert.ok(existsSync(profile));
    const run = (command) => {
      try {
        return { ok: true, out: execFileSync("/bin/bash", ["-c", walled(command, profile)], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
      } catch (err) {
        return { ok: false, out: String(err.stderr ?? err.message) };
      }
    };
    for (const command of ["echo more >> a.md", "sed -i '' s/note/x/ a.md", "mv a.md b.md", "echo new > c.md", "echo new > sub/d.md", "echo NEW > E.MD", "rm .pi/keep", "echo x > .pi/new"]) {
      const { ok, out } = run(command);
      assert.equal(ok, false, `${command} 는 거부되어야 한다: ${out}`);
      assert.match(out, /not permitted/i, command);
    }
    assert.equal(readFileSync(join(dir, "a.md"), "utf8"), "note\n", "노트는 그대로");
    assert.ok(existsSync(join(dir, ".pi/keep")), ".pi도 그대로");
    assert.equal(run("cat a.md && grep -c note a.md").out, "note\n1\n", "읽기는 된다");
    assert.equal(run("echo ok > notes.txt && cat notes.txt").out, "ok\n", "노트가 아닌 파일은 쓸 수 있다");
    assert.equal(run("cd sub && echo ok > ../notes.txt && cat ../notes.txt").out, "ok\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(appDir, { recursive: true, force: true });
  }
});

test("벽 뒤에서도 .octave 아래의 스펙은 쓸 수 있고, 거기를 지나 노트나 .pi로 가는 길은 막힌다", { skip: !hasWall() && "sandbox-exec가 없는 곳" }, () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "wall test ")));
  const appDir = mkdtempSync(join(tmpdir(), "wall-app-"));
  process.env.APP_DIR = appDir;
  try {
    writeFileSync(join(dir, "a.md"), "note\n");
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi/keep"), "x");
    const profile = writeProfile(dir);
    const run = (command) => {
      try {
        return { ok: true, out: execFileSync("/bin/bash", ["-c", walled(command, profile)], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
      } catch (err) {
        return { ok: false, out: String(err.stderr ?? err.message) };
      }
    };
    const spec = ".octave/specs/email-auth/requirements.md";
    for (const command of [
      `mkdir -p .octave/specs/email-auth && echo "# Requirements" > ${spec}`,
      `echo more >> ${spec}`,
      `sed -i '' s/more/less/ ${spec}`,
      "echo x > .octave/specs/email-auth/DESIGN.MD",
      "mv .octave/specs/email-auth .octave/specs/sign-in",
    ]) {
      const { ok, out } = run(command);
      assert.equal(ok, true, `${command} 는 되어야 한다: ${out}`);
    }
    assert.equal(readFileSync(join(dir, ".octave/specs/sign-in/requirements.md"), "utf8"), "# Requirements\nless\n");
    for (const command of [
      "echo x > .octave/../a.md",
      "ln -s ../a.md .octave/note.md && echo x > .octave/note.md",
      "ln -s .. .octave/up && echo x > .octave/up/a.md",
      "ln -s ../.pi .octave/app && echo x > .octave/app/keep",
      "mv a.md .octave/a.md",
      "echo x > .octave.md",
      "mkdir -p .octavex && echo x > .octavex/b.md",
    ]) {
      const { ok, out } = run(command);
      assert.equal(ok, false, `${command} 는 거부되어야 한다: ${out}`);
      assert.match(out, /not permitted/i, command);
    }
    assert.equal(readFileSync(join(dir, "a.md"), "utf8"), "note\n", "노트는 그대로");
    assert.equal(readFileSync(join(dir, ".pi/keep"), "utf8"), "x", ".pi도 그대로");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(appDir, { recursive: true, force: true });
  }
});
