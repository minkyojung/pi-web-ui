import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LinkStore, LINKS_PATH } from "../linkIndex.ts";

const DIR = mkdtempSync(join(tmpdir(), "links-"));
test.after(() => rmSync(DIR, { recursive: true, force: true }));
const put = (p, t) => { mkdirSync(join(DIR, p, ".."), { recursive: true }); writeFileSync(join(DIR, p), t); };

test("처음에는 노트를 읽어 만들고, 사이드카에 남긴다", () => {
  put("a.md", "to [[b]] and [[c|see]]\n");
  put("ideas/b.md", "back to [[a]]\n");
  const store = new LinkStore(DIR);
  store.load();
  assert.deepEqual(store.linksOf("a.md").map((l) => l.target), ["b", "c"]);
  assert.deepEqual(store.backlinks("a.md"), [{ path: "ideas/b.md", count: 1 }]);
  assert.deepEqual(store.backlinks("ideas/b.md"), [{ path: "a.md", count: 1 }]);
  assert.equal(existsSync(join(DIR, LINKS_PATH)), true);
});

test("사이드카가 폴더와 맞으면 그대로 쓰고, 안 맞으면 다시 만든다", () => {
  const fresh = new LinkStore(DIR);
  fresh.load();
  assert.deepEqual(fresh.backlinks("a.md"), [{ path: "ideas/b.md", count: 1 }]);
  put("c.md", "[[a]] [[a]]\n");
  const rebuilt = new LinkStore(DIR);
  rebuilt.load();
  assert.deepEqual(rebuilt.backlinks("a.md"), [{ path: "c.md", count: 2 }, { path: "ideas/b.md", count: 1 }]);
  writeFileSync(join(DIR, LINKS_PATH), "{ not json");
  const again = new LinkStore(DIR);
  again.load();
  assert.deepEqual(again.backlinks("a.md").length, 2);
});

test("고치면 옛 대상과 새 대상이 모두 '바뀌었을 수 있는 노트'로 나온다", () => {
  const store = new LinkStore(DIR);
  store.load();
  const touched = store.update("a.md", "now [[c]] only\n").backlinks;
  assert.deepEqual(touched.sort(), ["c.md", "ideas/b.md"]);
  assert.deepEqual(store.backlinks("ideas/b.md"), []);
  assert.deepEqual(store.backlinks("c.md"), [{ path: "a.md", count: 1 }]);
});

test("없는 노트로의 링크도 그 이름의 대상으로 잡힌다", () => {
  const store = new LinkStore(DIR);
  store.load();
  assert.deepEqual(store.update("c.md", "[[nowhere]]\n").backlinks.sort(), ["a.md", "nowhere.md"]);
});

test("이름이 바뀌면 키가 옮겨지고, 지우면 빠진다", () => {
  const store = new LinkStore(DIR);
  store.load();
  store.rename("a.md", "z.md");
  assert.deepEqual(store.linksOf("a.md"), []);
  assert.deepEqual(store.linksOf("z.md").map((l) => l.target), ["c"]);
  const touched = store.remove("z.md").backlinks;
  assert.deepEqual(touched, ["c.md"]);
  assert.deepEqual(store.backlinks("c.md"), []);
  assert.equal(JSON.parse(readFileSync(join(DIR, LINKS_PATH), "utf8")).notes["z.md"], undefined);
});

test("폴더와 맞아도 다른 파서가 만든 사이드카는 믿지 않고 다시 만든다", () => {
  // The flat shape the first parser wrote, with the folder's notes and none of their links.
  writeFileSync(join(DIR, LINKS_PATH), JSON.stringify({ "a.md": [], "ideas/b.md": [], "c.md": [] }));
  const store = new LinkStore(DIR);
  store.load();
  assert.deepEqual(store.backlinks("a.md"), [{ path: "c.md", count: 2 }, { path: "ideas/b.md", count: 1 }]);
  assert.equal(typeof JSON.parse(readFileSync(join(DIR, LINKS_PATH), "utf8")).version, "number");
});

test("삽입도 링크처럼 색인되어 백링크가 된다", () => {
  const store = new LinkStore(DIR);
  store.load();
  assert.deepEqual(store.update("c.md", "![[a]]\n").backlinks, ["a.md"]);
  assert.deepEqual(store.backlinks("a.md"), [{ path: "c.md", count: 1 }, { path: "ideas/b.md", count: 1 }]);
});

test("태그: 노트마다 한 번씩 적히고, 같은 태그의 다른 노트가 조회된다", () => {
  put("t1.md", "#work and #Work again, #home\n");
  put("t2.md", "#work\n");
  put("t3.md", "no tags\n");
  const store = new LinkStore(DIR);
  store.load();
  assert.deepEqual(store.tagsOf("t1.md"), ["work", "home"]);
  assert.deepEqual(store.tagged("t1.md"), [{ path: "t2.md", tags: ["work"] }]);
  assert.deepEqual(store.tagged("t3.md"), []);
  // From the sidecar, the same.
  const again = new LinkStore(DIR);
  again.load();
  assert.deepEqual(again.tagged("t2.md"), [{ path: "t1.md", tags: ["work"] }]);
});

test("태그를 고치면 옛 태그와 새 태그를 나눠 가진 노트가 모두 '바뀌었을 수 있는 노트'다", () => {
  const store = new LinkStore(DIR);
  store.load();
  assert.deepEqual(store.update("t2.md", "#home now\n").tagged.sort(), ["t1.md", "t2.md"]);
  assert.deepEqual(store.tagged("t2.md"), [{ path: "t1.md", tags: ["home"] }]);
  assert.deepEqual(store.remove("t2.md").tagged, ["t1.md"]);
  assert.deepEqual(store.tagged("t1.md"), []);
  put("t4.md", "#home\n");
  store.update("t4.md", "#home\n");
  store.rename("t4.md", "t5.md");
  assert.deepEqual(store.tagged("t1.md"), [{ path: "t5.md", tags: ["home"] }]);
});
