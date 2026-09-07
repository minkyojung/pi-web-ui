import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// READER_DIR is read when the module loads, so the directory has to exist first.
const DIR = mkdtempSync(join(tmpdir(), "reader-subs-"));
process.env.READER_DIR = DIR;
const { readSubscriptions, writeSubscriptions, subKey, label } = await import("../reader/fetch.ts");
const PATH = join(DIR, "subscriptions.json");

test.after(() => rmSync(DIR, { recursive: true, force: true }));

test("첫 읽기가 파일을 만들고, HN 하나로 시작한다", () => {
  assert.equal(existsSync(PATH), false);
  assert.deepEqual(readSubscriptions(), [{ kind: "hn" }]);
  assert.equal(existsSync(PATH), true);
});

test("쓴 것이 그대로 다시 읽힌다", () => {
  const subs = [{ kind: "hn" }, { kind: "rss", url: "https://example.com/feed.xml" }];
  writeSubscriptions(subs);
  assert.deepEqual(readSubscriptions(), subs);
});

test("손으로 열어볼 수 있는 모양으로 남는다", () => {
  writeSubscriptions([{ kind: "rss", url: "https://example.com/feed.xml" }]);
  const text = readFileSync(PATH, "utf8");
  assert.match(text, /\n {2}\{/, "한 줄로 뭉개지지 않는다");
  assert.equal(text.endsWith("\n"), true);
});

test("열쇠는 장부의 source 칸과 같은 값이다", () => {
  assert.equal(subKey({ kind: "hn" }), "hn");
  assert.equal(subKey({ kind: "rss", url: "https://example.com/feed.xml" }), "https://example.com/feed.xml");
});

test("라벨은 구독마다 다르다", () => {
  assert.equal(label({ kind: "hn" }), "hn(best)");
  assert.equal(label({ kind: "rss", url: "https://example.com/feed.xml" }), "https://example.com/feed.xml");
});
