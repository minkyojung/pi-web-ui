import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// APP_DIR is read when the module loads, so the directory has to exist first.
const DIR = mkdtempSync(join(tmpdir(), "settings-"));
process.env.APP_DIR = DIR;
const { DEFAULTS, coerce, readSettings, writeSettings } = await import("../settings.ts");
const { LOADOUT_SLOTS } = await import("../models.ts");
const PATH = join(DIR, "settings.json");

test.after(() => rmSync(DIR, { recursive: true, force: true }));

test("없는 파일은 기본값이고, 읽는다고 생기지 않는다", () => {
  assert.equal(existsSync(PATH), false);
  assert.deepEqual(readSettings(), DEFAULTS);
  assert.equal(existsSync(PATH), false, "바꾼 것이 없으면 파일도 없다");
});

test("쓴 것이 그대로 다시 읽힌다", () => {
  const next = { toolMode: "plan", loadout: ["openai/gpt-5.6-sol"] };
  assert.deepEqual(writeSettings(next), next);
  assert.deepEqual(readSettings(), next);
});

test("모르는 툴 모드는 기본 모드가 된다", () => {
  assert.equal(coerce({ toolMode: "root" }).toolMode, DEFAULTS.toolMode);
  assert.equal(coerce({}).toolMode, DEFAULTS.toolMode);
  assert.equal(coerce(null).toolMode, DEFAULTS.toolMode);
});

test("모르는 칸은 버려진다 — 파일을 손으로 고칠 수 있으므로", () => {
  assert.deepEqual(coerce({ toolMode: "coding", feedDays: 3 }), { toolMode: "coding", loadout: [] });
});

test("로드아웃은 문자열만 남기고, 목록이 아니면 비운다", () => {
  assert.deepEqual(coerce({ loadout: ["openai/gpt-5.5", 7, null, "anthropic/claude-opus-5"] }).loadout, [
    "openai/gpt-5.5",
    "anthropic/claude-opus-5",
  ]);
  assert.deepEqual(coerce({ loadout: "openai/gpt-5.5" }).loadout, [], "목록이 아니면 고른 것이 없는 셈");
  assert.deepEqual(coerce({}).loadout, []);
});

test("로드아웃은 칸 수를 넘지 않는다 — 화면에 그려지는 만큼만 남는다", () => {
  const many = Array.from({ length: LOADOUT_SLOTS + 3 }, (_, i) => `openai/m${i}`);
  assert.equal(coerce({ loadout: many }).loadout.length, LOADOUT_SLOTS);
  assert.deepEqual(coerce({ loadout: many }).loadout, many.slice(0, LOADOUT_SLOTS), "앞에서부터 남는다");
});

test("기본값의 로드아웃은 매번 새 배열이다 — 하나를 고치면 다 고쳐지면 안 되므로", () => {
  const first = coerce({});
  first.loadout.push("openai/gpt-5.5");
  assert.deepEqual(coerce({}).loadout, []);
  assert.deepEqual(DEFAULTS.loadout, []);
});

test("망가진 파일은 없는 파일과 같다", () => {
  writeFileSync(PATH, "{ 이건 JSON이 아니다");
  assert.deepEqual(readSettings(), DEFAULTS);
});

test("손으로 열어볼 수 있는 모양으로 남는다", () => {
  writeSettings(DEFAULTS);
  const text = readFileSync(PATH, "utf8");
  assert.match(text, /\n {2}"toolMode"/);
  assert.equal(text.endsWith("\n"), true);
});
