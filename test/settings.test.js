import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// READER_DIR is read when the module loads, so the directory has to exist first.
const DIR = mkdtempSync(join(tmpdir(), "settings-"));
process.env.READER_DIR = DIR;
const { DEFAULTS, LIMITS, coerce, readSettings, writeSettings } = await import("../settings.ts");
const PATH = join(DIR, "settings.json");

test.after(() => rmSync(DIR, { recursive: true, force: true }));

test("없는 파일은 기본값이고, 읽는다고 생기지 않는다", () => {
  assert.equal(existsSync(PATH), false);
  assert.deepEqual(readSettings(), DEFAULTS);
  assert.equal(existsSync(PATH), false, "바꾼 것이 없으면 파일도 없다");
});

test("쓴 것이 그대로 다시 읽힌다", () => {
  const next = { feedDays: 3, briefHours: 12, briefChars: 600, toolMode: "plan" };
  assert.deepEqual(writeSettings(next), next);
  assert.deepEqual(readSettings(), next);
});

test("범위를 벗어난 값은 거절이 아니라 가장 가까운 값이 된다", () => {
  const [lo, hi] = LIMITS.feedDays;
  assert.equal(coerce({ ...DEFAULTS, feedDays: 900 }).feedDays, hi);
  assert.equal(coerce({ ...DEFAULTS, feedDays: 0 }).feedDays, lo);
  assert.equal(coerce({ ...DEFAULTS, briefChars: -5 }).briefChars, LIMITS.briefChars[0]);
});

test("숫자가 아닌 것은 그 칸만 기본값으로 돌아간다", () => {
  const got = coerce({ feedDays: "많이", briefHours: 12, briefChars: null, toolMode: "coding" });
  assert.equal(got.feedDays, DEFAULTS.feedDays);
  assert.equal(got.briefChars, DEFAULTS.briefChars);
  assert.equal(got.briefHours, 12, "성한 칸은 살아남는다");
  assert.equal(got.toolMode, "coding");
});

test("문자열로 적힌 숫자는 숫자로 읽는다 — 파일을 손으로 고칠 수 있으므로", () => {
  assert.equal(coerce({ ...DEFAULTS, feedDays: "3" }).feedDays, 3);
});

test("빈 칸은 0이 아니다", () => {
  assert.equal(coerce({ ...DEFAULTS, briefChars: "" }).briefChars, DEFAULTS.briefChars);
  assert.equal(coerce({ ...DEFAULTS, briefChars: "   " }).briefChars, DEFAULTS.briefChars);
});

test("모르는 툴 모드는 기본 모드가 된다", () => {
  assert.equal(coerce({ toolMode: "root" }).toolMode, DEFAULTS.toolMode);
  assert.equal(coerce({}).toolMode, DEFAULTS.toolMode);
});

test("소수점은 정수로 접힌다", () => {
  assert.equal(coerce({ ...DEFAULTS, briefHours: 12.7 }).briefHours, 13);
});

test("망가진 파일은 없는 파일과 같다 — 수집 도중에 읽히므로 던지지 않는다", () => {
  writeFileSync(PATH, "{ 이건 JSON이 아니다");
  assert.deepEqual(readSettings(), DEFAULTS);
});

test("손으로 열어볼 수 있는 모양으로 남는다", () => {
  writeSettings(DEFAULTS);
  const text = readFileSync(PATH, "utf8");
  assert.match(text, /\n {2}"feedDays"/);
  assert.equal(text.endsWith("\n"), true);
});
