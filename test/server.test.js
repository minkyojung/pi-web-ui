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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

it("이름을 바꾸면 파일과 로그가 함께 옮겨지고 모든 탭이 듣는다", async () => {
  clear();
  send({ type: "open_note", path: "a.md" });
  const { modified } = await want("note");
  clear();
  send({ type: "rename_note", path: "a.md", to: "renamed/a2.md" });
  const renamed = await want("note_renamed");
  assert.deepEqual([renamed.from, renamed.to], ["a.md", "renamed/a2.md"]);
  const files = await want("files", (m) => m.files.some((f) => f.path === "renamed/a2.md"));
  assert.equal(files.files.some((f) => f.path === "a.md"), false);
  assert.ok(history("renamed/a2.md").length > 0, "로그가 따라왔다");
  // The version travelled too: a save on it lands, and is not taken for a conflict.
  await new Promise((r) => setTimeout(r, 300)); // the watcher's report of the move, if any
  clear();
  send({ type: "save_note", path: "renamed/a2.md", text: "# a\n\nafter rename\n", base: modified });
  const changed = await want("note_changed", (m) => m.path === "renamed/a2.md");
  assert.equal(changed.base, modified);
  // Back, so later tests find a.md.
  clear();
  send({ type: "rename_note", path: "renamed/a2.md", to: "a.md" });
  await want("note_renamed");
});

it("있는 이름, 없는 노트, 노트 아닌 이름으로는 바꿀 수 없고 이 탭만 듣는다", async () => {
  writeFileSync(join(cwd, "taken.md"), "x\n");
  clear();
  send({ type: "rename_note", path: "a.md", to: "taken.md" });
  assert.equal((await want("note_rename_failed")).reason, "exists");
  clear();
  send({ type: "rename_note", path: "nope.md", to: "x.md" });
  assert.equal((await want("note_rename_failed")).reason, "missing");
  clear();
  send({ type: "rename_note", path: "a.md", to: "../out.md" });
  assert.equal((await want("note_rename_failed")).reason, "invalid");
  assert.equal(readFileSync(join(cwd, "a.md"), "utf8").length > 0, true);
});

it("없는 노트를 열면 note_gone이고, 지워진 노트 위의 저장도 note_gone이며, 지워지는 것은 모든 탭이 듣는다", async () => {
  clear();
  send({ type: "open_note", path: "never.md" });
  assert.equal((await want("note_gone")).path, "never.md");
  writeFileSync(join(cwd, "doomed.md"), "soon\n");
  clear();
  send({ type: "open_note", path: "doomed.md" });
  const { modified } = await want("note", (m) => m.path === "doomed.md");
  clear();
  rmSync(join(cwd, "doomed.md"));
  assert.equal((await want("note_gone")).path, "doomed.md", "감시기가 알린다");
  clear();
  send({ type: "save_note", path: "doomed.md", text: "back\n", base: modified });
  assert.equal((await want("note_gone")).path, "doomed.md");
  clear();
  send({ type: "save_note", path: "doomed.md", text: "back\n", base: null });
  await want("note", (m) => m.path === "doomed.md");
  assert.equal(readFileSync(join(cwd, "doomed.md"), "utf8"), "back\n", "base 없이 쓰면 되살아난다");
});

it("지우면 휴지통으로 가고 로그도 따라가며, 되살리면 둘 다 돌아온다", async () => {
  writeFileSync(join(cwd, "bin.md"), "keep me\n");
  clear();
  send({ type: "open_note", path: "bin.md" });
  await want("note", (m) => m.path === "bin.md");
  clear();
  send({ type: "delete_note", path: "bin.md" });
  const deleted = await want("note_deleted");
  assert.deepEqual([deleted.path, deleted.trashed], ["bin.md", "bin.md"]);
  await want("files", (m) => !m.files.some((f) => f.path === "bin.md"));
  assert.equal(existsSync(join(cwd, ".pi/trash/notes/bin.md")), true);
  assert.equal(existsSync(join(cwd, ".pi/trash/history/bin.md.jsonl")), true, "로그가 따라갔다");
  assert.equal(inbox.some((m) => m.type === "note_gone"), false, "앱이 옮긴 것은 감시기가 다시 알리지 않는다");
  clear();
  send({ type: "restore_note", trashed: "bin.md", path: "bin.md" });
  assert.equal((await want("note_created")).path, "bin.md");
  await want("note", (m) => m.path === "bin.md");
  assert.equal(readFileSync(join(cwd, "bin.md"), "utf8"), "keep me\n");
  assert.equal(existsSync(join(cwd, ".pi/history/bin.md.jsonl")), true, "로그가 돌아왔다");
  clear();
  send({ type: "delete_note", path: "never.md" });
  assert.equal((await want("note_gone")).path, "never.md");
});

it("이름을 주고 새 노트를 청하면 그 이름이 되고, 있는 이름이나 안 되는 이름은 거절된다", async () => {
  clear();
  send({ type: "new_note", name: "../wanted" });
  assert.equal((await want("note_rename_failed")).reason, "invalid", "폴더 밖으로는 못 만든다");
  clear();
  send({ type: "new_note", name: "ideas/wanted" });
  assert.equal((await want("note_created")).path, "ideas/wanted.md", "슬래시는 폴더다");
  clear();
  send({ type: "new_note", name: "wanted" });
  assert.equal((await want("note_created")).path, "wanted.md");
  assert.equal(readFileSync(join(cwd, "wanted.md"), "utf8"), "");
  clear();
  send({ type: "new_note", name: "wanted" });
  assert.equal((await want("note_rename_failed")).reason, "exists");
});

it("노트를 열면 백링크가 오고, 다른 노트가 링크를 쓰면 다시 오며, 이름을 바꾸면 링크가 따라온다", async () => {
  writeFileSync(join(cwd, "target.md"), "# target\n");
  writeFileSync(join(cwd, "source.md"), "see [[target]] and [[target|it]]\n");
  await new Promise((r) => setTimeout(r, 400)); // the watcher's reports
  clear();
  send({ type: "open_note", path: "target.md" });
  const note = await want("note", (m) => m.path === "target.md");
  assert.deepEqual(note.backlinks, [{ path: "source.md", count: 2 }]);
  // Another note starts linking: the target hears its backlinks again.
  clear();
  send({ type: "open_note", path: "a.md" });
  const a = await want("note", (m) => m.path === "a.md");
  clear();
  send({ type: "save_note", path: "a.md", text: a.text + "\nalso [[target]]\n", base: a.modified });
  const again = await want("backlinks", (m) => m.path === "target.md");
  assert.deepEqual(again.notes.map((b) => b.path).sort(), ["a.md", "source.md"]);
  // Renamed: the links in the other notes point at the new name.
  clear();
  send({ type: "rename_note", path: "target.md", to: "goal.md" });
  await want("note_renamed");
  await want("note_changed", (m) => m.path === "source.md");
  assert.equal(readFileSync(join(cwd, "source.md"), "utf8"), "see [[goal]] and [[goal|it]]\n");
  assert.ok(readFileSync(join(cwd, "a.md"), "utf8").includes("[[goal]]"));
  const after = await want("backlinks", (m) => m.path === "goal.md" && m.notes.length === 2);
  assert.deepEqual(after.notes.map((b) => b.path).sort(), ["a.md", "source.md"]);
  assert.equal(history("source.md").at(-1).author, "me", "링크 고침은 내 편집으로 기록된다");
});

it("하위 폴더로 옮기면 링크가 경로 또는 제목으로 따라온다", async () => {
  // "lone" is the only note by its name, so its title still finds it in a
  // folder; "twin" has a namesake in other/, which its title would then mean.
  writeFileSync(join(cwd, "lone.md"), "# lone\n");
  writeFileSync(join(cwd, "twin.md"), "# twin\n");
  mkdirSync(join(cwd, "other"));
  writeFileSync(join(cwd, "other/twin.md"), "# the other twin\n");
  writeFileSync(join(cwd, "linker.md"), "[[lone]] and [[twin|t]]\n");
  await new Promise((r) => setTimeout(r, 400)); // the watcher's reports
  clear();
  send({ type: "rename_note", path: "lone.md", to: "sub/lone.md" });
  const lone = await want("backlinks", (m) => m.path === "sub/lone.md" && m.notes.length > 0);
  assert.deepEqual(lone.notes.map((b) => b.path), ["linker.md"]);
  assert.equal(readFileSync(join(cwd, "linker.md"), "utf8"), "[[lone]] and [[twin|t]]\n", "제목이 여전히 그 노트다");
  clear();
  send({ type: "rename_note", path: "twin.md", to: "sub/twin.md" });
  await until("the link to follow", () => readFileSync(join(cwd, "linker.md"), "utf8") === "[[lone]] and [[sub/twin|t]]\n");
  const twin = await want("backlinks", (m) => m.path === "sub/twin.md" && m.notes.length > 0);
  assert.deepEqual(twin.notes.map((b) => b.path), ["linker.md"]);
  assert.equal(existsSync(join(cwd, "lone.md")) || existsSync(join(cwd, "twin.md")), false);
  assert.ok(existsSync(join(cwd, "sub/lone.md")) && existsSync(join(cwd, "sub/twin.md")), "없던 폴더가 만들어졌다");
});

it("폴더 밖과 노트 아닌 것은 열리지도 쓰이지도 않는다", async () => {
  clear();
  send({ type: "open_note", path: "../etc/passwd.md" });
  assert.equal((await want("note_gone")).path, "../etc/passwd.md");
  clear();
  send({ type: "save_note", path: "../escape.md", text: "x", base: null });
  assert.match((await want("error")).message, /cannot save/);
  clear();
  send({ type: "open_note", path: "a.txt" });
  assert.equal((await want("note_gone")).path, "a.txt");
});

it("본문을 찾으면 일치한 줄이 이 탭에 오고, 답마다 요청 번호가 붙어 늦은 답을 버릴 수 있다", async () => {
  writeFileSync(join(cwd, "haystack.md"), "# hay\n\nsome straw and a NeedleWord here\n");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi/hidden.md"), "needleword\n");
  clear();
  // Two asks in a row, as typing makes them; the tab keeps the answer to the latest.
  send({ type: "search_notes", query: "needle", id: 1 });
  send({ type: "search_notes", query: "NEEDLEWORD", id: 2 });
  await want("search_results", (m) => m.id === 1);
  await want("search_results", (m) => m.id === 2);
  const answers = inbox.filter((m) => m.type === "search_results");
  assert.deepEqual(answers.map((m) => [m.id, m.query]), [[1, "needle"], [2, "NEEDLEWORD"]], "each answer says which ask it answers");
  const latest = answers.filter((m) => m.id === 2);
  assert.equal(latest.length, 1, "what a tab keeps once the late one is dropped");
  assert.deepEqual(
    latest[0].hits.map((h) => [h.path, h.line, h.text.slice(h.from, h.to)]),
    [["haystack.md", 3, "NeedleWord"]],
    "대소문자를 가리지 않고, .pi/ 아래는 노트가 아니다",
  );
  clear();
  send({ type: "search_notes", query: "   ", id: 3 });
  assert.deepEqual((await want("search_results", (m) => m.id === 3)).hits, []);
});

it("모르는 메시지는 버려지지 않고 이 탭에 에러로 답한다", async () => {
  clear();
  send({ type: "frobnicate" });
  assert.match((await want("error")).message, /does not understand "frobnicate"/);
});

it("잘못된 JSON은 이 탭에만 에러이고 서버는 산다", async () => {
  clear();
  ws.send("{not json");
  assert.match((await want("error")).message, /invalid JSON/);
  clear();
  send({ type: "open_note", path: "a.md" });
  await want("note");
});
