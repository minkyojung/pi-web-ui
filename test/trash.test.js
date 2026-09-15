/**
 * 지우면 어디로 가는가, 그리고 셸에게 어떻게 부탁하는가.
 *
 * 시스템 휴지통 쪽은 주입받게 되어 있으므로 Electron 없이도 두 길을 다 물어볼 수 있다.
 * 부탁하는 말(전선 위의 모양)은 따로 핀으로 박는다 — 그쪽은 electron/main.js와 둘이서만
 * 아는 약속이라, 한쪽만 이름이 바뀌면 조용히 폴백으로 내려앉는다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deleteNote } from "../trash.ts";

const vault = () => {
  const root = mkdtempSync(join(tmpdir(), "trash-test-"));
  writeFileSync(join(root, "a.md"), "# a\n");
  return root;
};

test("셸이 있으면 기계의 휴지통으로 간다 — vault 안에는 아무것도 남지 않는다", async () => {
  const root = vault();
  try {
    const asked = [];
    const done = await deleteNote(root, "a.md", async (full) => (asked.push(full), true));
    assert.deepEqual(done, { ok: true, to: "system" });
    // The name the file system settled on, not the one that was typed: /tmp is a
    // symlink on a Mac, and the shell should be given the file, not a way to it.
    assert.deepEqual(asked, [join(realpathSync(root), "a.md")], "셸에게는 풀어낸 절대 경로를 준다");
    assert.equal(existsSync(join(root, ".pi/trash")), false, "앱 휴지통은 쓰이지 않는다");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("셸이 없으면 vault의 휴지통으로 간다 — 되돌릴 이름과 함께", async () => {
  const root = vault();
  try {
    const done = await deleteNote(root, "a.md", null);
    assert.deepEqual(done, { ok: true, to: "vault", trashed: "a.md" });
    assert.equal(readFileSync(join(root, ".pi/trash/notes/a.md"), "utf8"), "# a\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("셸이 못 하겠다고 하면 노트를 그 자리에 두지 않는다 — vault의 휴지통이 받는다", async () => {
  const root = vault();
  try {
    const done = await deleteNote(root, "a.md", async () => false);
    assert.deepEqual(done, { ok: true, to: "vault", trashed: "a.md" });
    assert.equal(existsSync(join(root, "a.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("없는 노트와 폴더 밖의 이름은 지워지지 않는다", async () => {
  const root = vault();
  try {
    assert.deepEqual(await deleteNote(root, "nope.md", null), { ok: false, reason: "missing" });
    assert.deepEqual(await deleteNote(root, "../outside.md", null), { ok: false, reason: "invalid" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("셸에게 부탁하는 말: ask와 id와 절대 경로, 그리고 돌아온 답이 그 부탁의 답이다", async () => {
  // A child with an ipc channel is the only place shellTrash exists at all, so
  // the wire is asked about from one — this process stands in for
  // electron/main.js, and answers the second ask first, so a reply matched by
  // id rather than by arrival is what passes.
  const trash = JSON.stringify(new URL("../trash.ts", import.meta.url).href);
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { shellTrash } = await import(${trash});
    const trash = shellTrash(4000);
    process.send({ done: await Promise.all([trash("/one.md"), trash("/two.md")]) });
  `], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const asks = [];
  try {
    const done = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("message", (m) => {
        if (m.done) return resolve(m.done);
        asks.push(m);
        if (asks.length === 2) {
          child.send({ ask: "trash", id: asks[1].id, ok: false });
          child.send({ ask: "trash", id: asks[0].id, ok: true });
        }
      });
    });
    assert.deepEqual(asks.map((a) => a.ask), ["trash", "trash"]);
    assert.deepEqual(asks.map((a) => a.path), ["/one.md", "/two.md"], "셸에게는 절대 경로를 준다");
    assert.notEqual(asks[0].id, asks[1].id, "부탁마다 제 id를 단다");
    assert.deepEqual(done, [true, false], "답은 도착 순서가 아니라 id로 맞춰진다");
  } finally {
    child.kill();
  }
});

test("셸이 없는 프로세스에는 그 길이 아예 없다", async () => {
  // This process was not forked with an ipc channel, so process.send is not there.
  const { shellTrash } = await import("../trash.ts");
  assert.equal(shellTrash(), null);
});
