/**
 * The server, real, over a real socket.
 *
 * Boots server.ts on a free port with a folder of its own and talks to it the
 * way the browser does. No mocks of the file system or of pi: what is pinned
 * here is what a tab actually gets back. It needs what the server needs — pi
 * with usable credentials — and says so and skips rather than failing when
 * that is missing, since the failure would be about the machine, not the code.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const NO_CREDENTIALS = "No model has usable credentials";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const until = async (what, get, ms = 15000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await get();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

let cwd, server, port, log = "", skip = false;
let ws, inbox;

test.before(async () => {
  cwd = mkdtempSync(join(tmpdir(), "server-test-"));
  writeFileSync(join(cwd, "a.md"), "# a\n\nfirst\n");
  port = await freePort();
  server = spawn(join(root, "node_modules/.bin/tsx"), ["server.ts"], {
    cwd: root,
    env: { ...process.env, WORKDIR: cwd, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const exited = new Promise((resolve) => server.once("exit", () => resolve("exited")));
  const up = until("the server", () => fetch(`http://127.0.0.1:${port}/api/settings`).then((r) => r.ok).catch(() => false), 30000);
  if ((await Promise.race([up, exited])) === "exited") {
    if (log.includes(NO_CREDENTIALS)) {
      skip = true;
      return;
    }
    throw new Error(`server did not start:\n${log}`);
  }
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  inbox = [];
  ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
  await until("the socket", () => ws.readyState === 1);
});

test.after(async () => {
  ws?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGINT");
    await new Promise((r) => { const t = setTimeout(() => { server.kill("SIGKILL"); r(); }, 5000); server.once("exit", () => { clearTimeout(t); r(); }); });
  }
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

const send = (m) => ws.send(JSON.stringify(m));
const want = (type, pred = () => true) => until(type, () => inbox.find((m) => m.type === type && pred(m)));
const clear = () => (inbox.length = 0);
const history = (path) => readFileSync(join(cwd, `.pi/history/${path}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const it = (name, fn) => test(name, async (t) => {
  if (skip) return t.skip(`${NO_CREDENTIALS} — the server cannot start on this machine`);
  await fn(t);
});

it("접속하면 서버의 상태가 먼저 온다 — 설정, 목록, 스냅샷", async () => {
  await want("config");
  const files = await want("files");
  assert.deepEqual(files.files.map((f) => f.path), ["a.md"]);
  await want("snapshot");
});

it("노트를 열면 본문과 버전과 작성자 구간이 오고, 처음 본 노트는 통째로 바깥 것이다", async () => {
  clear();
  send({ type: "open_note", path: "a.md" });
  const note = await want("note");
  assert.equal(note.text, "# a\n\nfirst\n");
  assert.equal(typeof note.modified, "number");
  assert.deepEqual(note.spans.map((s) => s.author), ["outside"]);
});

it("읽은 버전 위에 저장하면 그 변경이 내 것으로 모든 탭에 오고, 디스크에 닿는다", async () => {
  clear();
  send({ type: "open_note", path: "a.md" });
  const { modified } = await want("note");
  clear();
  send({ type: "save_note", path: "a.md", text: "# a\n\nfirst, then mine\n", base: modified });
  const changed = await want("note_changed");
  assert.equal(changed.base, modified);
  assert.ok(changed.modified > modified);
  assert.equal(changed.changes.length, 1);
  assert.equal(changed.changes[0].author, "me");
  assert.equal(readFileSync(join(cwd, "a.md"), "utf8"), "# a\n\nfirst, then mine\n");
  const text = "# a\n\nfirst, then mine\n";
  assert.deepEqual(
    changed.spans.map((s) => [s.author, text.slice(s.from, s.to)]),
    [["outside", "# a\n\nfirst"], ["me", ", then mine"], ["outside", "\n"]],
  );
});

it("낡은 버전 위의 저장은 거절되고 아무것도 쓰지 않는다", async () => {
  clear();
  send({ type: "open_note", path: "a.md" });
  const { modified } = await want("note");
  clear();
  send({ type: "save_note", path: "a.md", text: "stale\n", base: modified - 1 });
  const refused = await want("note_conflict");
  assert.equal(refused.modified, modified);
  assert.equal(readFileSync(join(cwd, "a.md"), "utf8").includes("stale"), false);
});

it("앱을 거치지 않은 쓰기는 바깥의 변경으로 온다", async () => {
  clear();
  send({ type: "open_note", path: "a.md" });
  const { modified } = await want("note");
  clear();
  writeFileSync(join(cwd, "a.md"), "# a\n\nfirst, then mine, then vim\n");
  const changed = await want("note_changed", (m) => m.changes.some((c) => c.author === "outside"));
  assert.equal(changed.base, modified, "탭이 가진 버전 위의 변경으로 온다");
  assert.ok(changed.changes[0].inserted.includes("then vim"));
  assert.equal(history("a.md").at(-1).author, "outside");
});

it("받아들이면 글은 그대로이고 구간만 accepted가 된다", async () => {
  // Seed a note pi wrote in, by the log's own format.
  writeFileSync(join(cwd, "p.md"), "pi wrote this\n");
  writeFileSync(join(cwd, ".pi/history/p.md.jsonl"), JSON.stringify({ author: "pi", at: 1, sessionId: "s", entryId: "e", from: 0, to: 0, inserted: "pi wrote this\n", removed: "" }) + "\n");
  clear();
  send({ type: "open_note", path: "p.md" });
  const note = await want("note", (m) => m.path === "p.md");
  assert.deepEqual(note.spans.map((s) => [s.author, s.accepted ?? false]), [["pi", false]]);
  clear();
  send({ type: "accept_note", path: "p.md", from: 0, to: 13 });
  const changed = await want("note_changed", (m) => m.path === "p.md");
  assert.deepEqual(changed.changes, []);
  assert.deepEqual(changed.spans.map((s) => [s.author, s.accepted ?? false]), [["pi", true], ["pi", false]]);
  assert.equal(readFileSync(join(cwd, "p.md"), "utf8"), "pi wrote this\n");
});

it("없던 노트는 base가 null일 때 만들어져 통째로 오고, 목록에 오른다", async () => {
  clear();
  send({ type: "save_note", path: "new/one.md", text: "new\n", base: null });
  const note = await want("note", (m) => m.path === "new/one.md");
  assert.deepEqual(note.spans.map((s) => s.author), ["me"]);
  const files = await want("files", (m) => m.files.some((f) => f.path === "new/one.md"));
  assert.equal(files.files[0].path, "new/one.md", "새 것이 맨 위");
});

it("새 노트를 청하면 Untitled로 만들어져 이 탭에 이름이 오고, 두 번째는 번호가 붙는다", async () => {
  clear();
  send({ type: "new_note" });
  const first = await want("note_created");
  assert.equal(first.path, "Untitled.md");
  assert.equal(readFileSync(join(cwd, first.path), "utf8"), "");
  await want("note", (m) => m.path === first.path);
  await want("files", (m) => m.files.some((f) => f.path === first.path));
  clear();
  send({ type: "new_note" });
  assert.equal((await want("note_created")).path, "Untitled 2.md");
});

it("폴더 밖과 노트 아닌 것은 열리지도 쓰이지도 않는다", async () => {
  clear();
  send({ type: "open_note", path: "../etc/passwd.md" });
  assert.match((await want("error")).message, /no such note/);
  clear();
  send({ type: "save_note", path: "../escape.md", text: "x", base: null });
  assert.match((await want("error")).message, /cannot save/);
  clear();
  send({ type: "open_note", path: "a.txt" });
  assert.match((await want("error")).message, /no such note/);
});

it("잘못된 JSON은 이 탭에만 에러이고 서버는 산다", async () => {
  clear();
  ws.send("{not json");
  assert.match((await want("error")).message, /invalid JSON/);
  clear();
  send({ type: "open_note", path: "a.md" });
  await want("note");
});
