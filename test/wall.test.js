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

test("프로파일은 앱의 폴더만 막고, 경로의 특수문자는 글자로 읽힌다", () => {
  const profile = profileFor("/Users/a.b/My Notes (2026)");
  assert.match(profile, /\(allow default\)/);
  assert.ok(profile.includes(`(subpath "/Users/a.b/My Notes (2026)/.pi")`), profile);
  assert.equal(/\[mM\]\[dD\]/.test(profile), false, "마크다운은 더 이상 특별하지 않다");
  assert.equal(profile.includes(".octave"), false, "노트 규칙이 없으니 거기에 낼 구멍도 없다");
});

test("감싼 명령은 sandbox-exec 아래의 bash로 간다", () => {
  assert.equal(walled("ls -la", "/p/x.sb"), "exec /usr/bin/sandbox-exec -f '/p/x.sb' /bin/bash -c 'ls -la'");
});

// The wall itself, where there is one to test. Each command is run the way pi
// runs a bash call — `/bin/bash -c <command>` — with the command walled first.
test("벽 뒤에서 막히는 것은 앱의 폴더뿐이다 — 노트도 스펙도 그냥 써진다", { skip: !hasWall() && "sandbox-exec가 없는 곳" }, () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "wall test ")));
  const appDir = mkdtempSync(join(tmpdir(), "wall-app-"));
  process.env.APP_DIR = appDir;
  try {
    writeFileSync(join(dir, "a.md"), "note\n");
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, ".pi"));
    mkdirSync(join(dir, ".octave"));
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
    // The app's folder, by any path that leads there.
    for (const command of ["rm .pi/keep", "echo x > .pi/new", "ln -s ../.pi .octave/app && echo x > .octave/app/keep"]) {
      const { ok, out } = run(command);
      assert.equal(ok, false, `${command} 는 거부되어야 한다: ${out}`);
      assert.match(out, /not permitted/i, command);
    }
    assert.equal(readFileSync(join(dir, ".pi/keep"), "utf8"), "x", ".pi는 그대로");
    // Everything else in the folder, notes among it.
    for (const command of ["echo more >> a.md", "echo new > c.md", "echo new > sub/d.md", "mkdir -p .octave/specs/x && echo y > .octave/specs/x/requirements.md", "echo ok > notes.txt"]) {
      const { ok, out } = run(command);
      assert.equal(ok, true, `${command} 는 되어야 한다: ${out}`);
    }
    assert.equal(readFileSync(join(dir, "a.md"), "utf8"), "note\nmore\n", "노트도 셸이 쓴다");
    assert.equal(run("cat a.md | head -1").out, "note\n", "읽기는 그대로");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(appDir, { recursive: true, force: true });
  }
});
