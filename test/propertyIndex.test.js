import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PropertyStore } from "../propertyIndex.ts";

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

/** A folder of notes, and the index of it. */
function vault(notes) {
  const dir = mkdtempSync(join(tmpdir(), "properties-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(notes)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const store = new PropertyStore(dir);
  store.load();
  return store;
}

test("처음에는 노트를 읽어 이름과 값을 모은다: 많이 쓰인 것이 먼저", () => {
  const store = vault({
    "a.md": "---\nstatus: draft\ntags: [work]\n---\nbody\n",
    "notes/b.md": "---\nstatus: done\n---\nbody\n",
    "c.md": "no block here\n",
  });
  const { names, values } = store.all();
  assert.deepEqual(names, ["status", "tags"]);
  assert.deepEqual(values.status, ["done", "draft"], "같은 수면 글자 순");
  assert.deepEqual(values.tags, ["work"]);
});

test("대소문자가 다른 철자는 한 이름이고, 많이 쓰인 철자로 말한다", () => {
  const store = vault({
    "a.md": "---\nstatus: x\n---\n",
    "b.md": "---\nStatus: y\n---\n",
    "c.md": "---\nStatus: z\n---\n",
  });
  const { names, values } = store.all();
  assert.deepEqual(names, ["Status"]);
  assert.deepEqual(values.status, ["x", "y", "z"], "두 철자의 값이 한 자리에 모인다");
});

test("고치면 바뀌었다고 하고, 같은 말이면 아니라고 한다", () => {
  const store = vault({ "a.md": "---\nstatus: draft\n---\nbody\n" });
  assert.equal(store.update("a.md", "---\nstatus: draft\n---\nbody 다시\n"), false, "본문만 바뀐 것은 색인이 알 바 아니다");
  assert.equal(store.update("a.md", "---\nstatus: parked\n---\n"), true);
  assert.deepEqual(store.all().values.status, ["parked"]);
  assert.equal(store.update("새.md", "---\nowner: 나\n---\n"), true, "처음 보는 노트");
  assert.deepEqual(store.all().names, ["owner", "status"]);
});

test("지우면 그 노트의 말이 빠지고, 이름이 바뀌면 따라간다", () => {
  const store = vault({ "a.md": "---\nstatus: draft\n---\n", "b.md": "---\nstatus: done\n---\n", "plain.md": "nothing\n" });
  store.rename("b.md", "notes/moved.md");
  assert.deepEqual(store.all().values.status, ["done", "draft"], "옮겨도 볼트가 하는 말은 같다");
  assert.equal(store.remove("notes/moved.md"), true);
  assert.deepEqual(store.all().values.status, ["draft"]);
  assert.equal(store.remove("notes/moved.md"), false, "없던 것을 지우는 것은 바뀐 것이 아니다");
  assert.equal(store.remove("plain.md"), false, "속성이 없던 노트도 마찬가지");
});

test("깨진 블록은 아무 이름도 보태지 않는다", () => {
  const store = vault({ "a.md": "---\ntags: [work]\n---\n" });
  assert.equal(store.update("broken.md", "---\ntags: [x\n---\n"), false);
  assert.deepEqual(store.all(), { names: ["tags"], values: { tags: ["work"] } });
});
