import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The old place is only looked at when APP_DIR is not set, so this file runs
// on a home of its own instead — homedir() reads HOME, and settings.ts reads
// both when it loads.
const HOME = mkdtempSync(join(tmpdir(), "settings-legacy-"));
process.env.HOME = HOME;
delete process.env.APP_DIR;
const { DEFAULTS, SETTINGS_PATH, readSettings, writeSettings } = await import("../settings.ts");
const LEGACY = join(HOME, ".pi", "web-ui", "settings.json");
// Plan, which the ladder has had throughout: what is pinned here is the move
// from one path to another, not what a mode saved long ago now means.
const chosen = { toolMode: "plan", loadout: ["openai/gpt-4o-mini", "anthropic/claude-fable-5"], created: true };

const fresh = () => {
  rmSync(join(HOME, ".octave"), { recursive: true, force: true });
  rmSync(join(HOME, ".pi"), { recursive: true, force: true });
};
const legacy = (text) => {
  mkdirSync(join(HOME, ".pi", "web-ui"), { recursive: true });
  writeFileSync(LEGACY, text);
};

test.after(() => rmSync(HOME, { recursive: true, force: true }));

test("기본 자리는 홈 아래 .octave다", () => {
  assert.equal(SETTINGS_PATH, join(HOME, ".octave", "settings.json"));
});

test("예전 자리에만 설정이 있으면 새 자리로 옮겨 와 그대로 읽힌다", () => {
  fresh();
  legacy(JSON.stringify(chosen));
  // Over the defaults: a setting added since the old file was written is not in it.
  assert.deepEqual(readSettings(), { ...DEFAULTS, ...chosen });
  assert.deepEqual(JSON.parse(readFileSync(SETTINGS_PATH, "utf8")), { ...DEFAULTS, ...chosen }, "새 자리에 쓰였다");
  assert.equal(existsSync(LEGACY), true, "예전 파일은 남는다");
});

test("새 자리에 파일이 있으면 예전 자리는 보지 않는다 — 옮겨 온 뒤의 변경을 되돌리지 않도록", () => {
  fresh();
  legacy(JSON.stringify(chosen));
  const later = writeSettings({ toolMode: "execution", loadout: ["openai/gpt-5.5"], created: false });
  assert.deepEqual(readSettings(), later);
});

test("예전 파일이 망가졌으면 옮길 것이 없고, 기본값이며, 새 파일도 생기지 않는다", () => {
  fresh();
  legacy("{ 이건 JSON이 아니다");
  assert.deepEqual(readSettings().loadout, []);
  assert.equal(existsSync(SETTINGS_PATH), false);
});

test("두 자리 다 없으면 기본값이고, 읽는다고 파일이 생기지 않는다", () => {
  fresh();
  assert.deepEqual(readSettings().loadout, []);
  assert.equal(existsSync(SETTINGS_PATH), false);
});
