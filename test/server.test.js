/**
 * The server, real, over a real socket.
 *
 * Boots server.ts on a free port with a folder of its own and talks to it the
 * way the browser does. No mocks of the file system or of pi: what is pinned
 * here is what a tab actually gets back. The server starts without pi's
 * credentials, but nothing below can be asked of it then, so on a machine
 * without them these say so and skip rather than fail, since the failure
 * would be about the machine, not the code.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { approve } from "../specApproval.ts";

const root = new URL("..", import.meta.url).pathname;
const NO_CREDENTIALS = "No provider is signed in";

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

let cwd, appDir, clientDir, server, port, log = "", skip = false;
let ws, inbox;

test.before(async () => {
  cwd = mkdtempSync(join(tmpdir(), "server-test-"));
  writeFileSync(join(cwd, "a.md"), "# a\n\nfirst\n");
  port = await freePort();
  // Its own settings directory, as it has its own folder and its own port: the
  // server writes a log there now, and a test run has no business in the log
  // the person's own app keeps.
  appDir = mkdtempSync(join(tmpdir(), "server-test-app-"));
  // The extensions installed for this machine's pi stay out of this run: what
  // they add differs from machine to machine, and one of them is slow to
  // start. The switch that says so is Octave's own setting.
  writeFileSync(join(appDir, "settings.json"), JSON.stringify({ loadExtensions: false }));
  // A built page of its own, so what the server says of a built file can be asked: see the .mjs check.
  clientDir = mkdtempSync(join(tmpdir(), "server-test-client-"));
  mkdirSync(join(clientDir, "assets"));
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>test</title>");
  writeFileSync(join(clientDir, "assets", "worker.mjs"), "export {};\n");
  server = spawn(join(root, "node_modules/.bin/tsx"), ["server.ts"], {
    cwd: root,
    env: { ...process.env, WORKDIR: cwd, PORT: String(port), APP_DIR: appDir, CLIENT_DIR: clientDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const exited = new Promise((resolve) => server.once("exit", () => resolve("exited")));
  const up = until("the server", () => fetch(`http://127.0.0.1:${port}/api/settings`).then((r) => r.ok).catch(() => false), 30000);
  if ((await Promise.race([up, exited])) === "exited") throw new Error(`server did not start:\n${log}`);
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  inbox = [];
  ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
  await until("the socket", () => ws.readyState === 1);
  // The first config says whether pi has a model to run on; without one the
  // server is up but there is nobody at the table to test against.
  const first = await until("config", () => inbox.find((m) => m.type === "config"), 30000);
  if (!first.model) skip = true;
});

test.after(async () => {
  ws?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGINT");
    await new Promise((r) => { const t = setTimeout(() => { server.kill("SIGKILL"); r(); }, 5000); server.once("exit", () => { clearTimeout(t); r(); }); });
  }
  if (cwd) rmSync(cwd, { recursive: true, force: true });
  if (appDir) rmSync(appDir, { recursive: true, force: true });
  if (clientDir) rmSync(clientDir, { recursive: true, force: true });
});

const send = (m) => ws.send(JSON.stringify(m));
const want = (type, pred = () => true, ms) => until(type, () => inbox.find((m) => m.type === type && pred(m)), ms);
const clear = () => (inbox.length = 0);
const history = (path) => readFileSync(join(cwd, `.pi/history/${path}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const it = (name, fn) => test(name, async (t) => {
  if (skip) return t.skip(`${NO_CREDENTIALS} — the server cannot start on this machine`);
  await fn(t);
});

it("확장 스위치가 꺼져 있으면 도구는 pi의 것과 우리 것뿐이고, 이 기계의 pi에 설치된 확장은 실리지 않는다", async () => {
  const config = await want("config");
  const names = config.tools.map((t) => t.name);
  assert.ok(names.includes("ask_user"), `ask_user among ${names.join(", ")}`);
  assert.ok(names.includes("web_search"), `web_search among ${names.join(", ")}`);
  // There to be turned on, and off until it is: a new session sends nothing to a search.
  assert.deepEqual(config.activeTools.filter((n) => ["web_search", "fetch_content", "source_check", "get_search_content"].includes(n)), [], "the web is off when a session opens");
  // pi's built-ins, the four Octave brings, and the four of pi-web-access —
  // which is a dependency of ours, loaded from our own node_modules. With the
  // switch off, whatever ~/.pi/agent/settings.json names stays in the terminal
  // it was installed for; extensions.test.js is where it is on.
  const known = new Set(["read", "grep", "find", "ls", "edit", "write", "bash", "powershell", "note_edit", "note_write", "note_properties", "ask_user", "web_search", "fetch_content", "source_check", "get_search_content"]);
  assert.deepEqual(names.filter((n) => !known.has(n)), [], `only known tools among ${names.join(", ")}`);
  if (process.platform !== "win32") assert.ok(!names.includes("powershell"), "no powershell where there is none to run");
  assert.ok(!log.includes("sendFlowsList"), "the dashboard bridge never started");
  assert.ok(!log.includes("did not answer"), "nothing warned about a missing hook");
});

it("a picture in the folder is served for the note that shows it; anything else is not", async () => {
  mkdirSync(join(cwd, "images"), { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  writeFileSync(join(cwd, "images", "shot.png"), png);
  writeFileSync(join(cwd, ".pi", "secret.png"), png);
  writeFileSync(join(cwd, "not-a-picture.txt"), "x");
  const get = (path) => fetch(`http://127.0.0.1:${port}/vault/${path}`);
  let r = await get("images/shot.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await r.arrayBuffer()).toString("hex"), png.toString("hex"));
  r = await get("shot.png?from=a.md");
  assert.equal(r.status, 200, "by name alone, wherever it is");
  assert.equal((await get("../" + basename(cwd) + "/images/shot.png")).status, 404, "not outside by ..");
  assert.equal((await get(".pi/secret.png")).status, 404, "not under the app's folder");
  assert.equal((await get("secret.png")).status, 404, "nor by name");
  assert.equal((await get("not-a-picture.txt")).status, 404, "only pictures");
  assert.equal((await get("a.md")).status, 404, "a note is not a picture");
});

it("a note's text is read for an embed of it; anything that is not a note in the folder is not", async () => {
  writeFileSync(join(cwd, "embedded.md"), "# embedded\n\nwords\n");
  const get = (path) => fetch(`http://127.0.0.1:${port}/api/note?path=${encodeURIComponent(path)}`);
  const r = await get("embedded.md");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { path: "embedded.md", text: "# embedded\n\nwords\n" });
  assert.equal((await get("nowhere.md")).status, 404);
  // A real note one folder up: reachable by .. as a path, refused as a note.
  const outside = join(cwd, "..", `octave-outside-${basename(cwd)}.md`);
  writeFileSync(outside, "# outside\n");
  try {
    assert.equal((await get(`../${basename(outside)}`)).status, 404, "not outside by ..");
  } finally {
    rmSync(outside, { force: true });
  }
  assert.equal((await get("not-a-picture.txt")).status, 404, "a note is a .md file");
});

it("a picture pasted into a note is kept in the folder, under a name the note can use", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const post = (name, body = png) => fetch(`http://127.0.0.1:${port}/api/attachment?from=a.md&name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body });
  let r = await post("Pasted image 20260918040506.png");
  assert.equal(r.status, 201);
  const { path } = await r.json();
  const name = "Pasted image 20260918040506.png";
  assert.equal(path, `attachments/${name}`);
  assert.equal(readFileSync(join(cwd, path)).toString("hex"), png.toString("hex"), "the bytes, as sent");
  r = await fetch(`http://127.0.0.1:${port}/vault/${encodeURIComponent(name)}?from=a.md`);
  assert.equal(r.status, 200, "and the note can show it by name alone");
  assert.equal((await post("notes.txt", Buffer.from("x"))).status, 415, "not a kind the folder takes");
});

it("a built module is served as JavaScript: a browser will not run pdf.js's worker as anything else", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/assets/worker.mjs`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/javascript/);
});

it("a version's notes come from the changelog beside the server, cut as the release script cuts them", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/changelog?version=0.0.1`);
  assert.equal(r.status, 200);
  const { version, notes } = await r.json();
  assert.equal(version, "0.0.1");
  assert.match(notes, /^The first release\./, "the 0.0.1 section, from its first line");
  assert.ok(!notes.includes("## ["), "the section alone, not the file");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/changelog?version=9.9.9`)).status, 404, "a version the file has no section for");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/changelog?version=abc`)).status, 400, "not a version");
});

it("접속하면 /가 부를 수 있는 것의 목록이 오고, pi-web-access의 커맨드가 그 안에 있다", async () => {
  const { commands } = await want("commands");
  const names = commands.filter((c) => c.source === "extension").map((c) => c.name);
  for (const name of ["websearch", "curator", "google-account", "search"]) assert.ok(names.includes(name), `${name} among ${names.join(", ")}`);
  for (const c of commands) {
    assert.ok(["extension", "prompt", "skill"].includes(c.source), `${c.name}: a kind pi lists`);
    if (c.source === "skill") assert.match(c.name, /^skill:/);
  }
});

it("접속하면 제공자 목록이 오고, pi의 /login이 아는 것과 같다 — Anthropic은 두 길, OpenAI는 키 하나", async () => {
  const { providers } = await want("providers");
  const anthropic = providers.find((p) => p.id === "anthropic");
  const openai = providers.find((p) => p.id === "openai");
  assert.deepEqual(anthropic.methods, ["oauth", "api_key"]);
  assert.deepEqual(openai.methods, ["api_key"]);
  for (const p of providers) assert.ok(p.methods.length || p.signedIn, `${p.id}: listed for a reason`);
});

it("접속하면 서버의 상태가 먼저 온다 — 설정, 목록, 스냅샷", async () => {
  await want("config");
  const files = await want("files");
  assert.deepEqual(files.files.map((f) => f.path), ["a.md"]);
  await want("snapshot");
});

it("저장소의 파일은 읽기로 열리고, 열어 둔 동안 디스크의 변경이 따라오며, 닫으면 멈춘다", async () => {
  writeFileSync(join(cwd, "tool.ts"), "const a = 1;\n");
  clear();
  send({ type: "open_code", path: "tool.ts" });
  const first = await want("code");
  assert.equal(first.path, "tool.ts");
  assert.equal(first.text, "const a = 1;\n");
  assert.equal(first.truncated, false);

  // 앱을 거치지 않은 쓰기 — 작업이 쓰는 것이 이것이다.
  clear();
  writeFileSync(join(cwd, "tool.ts"), "const a = 2;\n");
  await want("code", (m) => m.text === "const a = 2;\n");

  // 닫은 뒤에는 오지 않는다: 저장소 하나를 통째로 방송하지 않기 위한 전부다.
  send({ type: "close_code" });
  await new Promise((r) => setTimeout(r, 300));
  clear();
  writeFileSync(join(cwd, "tool.ts"), "const a = 3;\n");
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(inbox.some((m) => m.type === "code"), false, "닫은 탭에는 보내지 않는다");
});

it("명령이 찍은 로그(.pi/runs/)는 앱의 폴더에 있어도 읽기로 열리고, 자라면 따라온다", async () => {
  mkdirSync(join(cwd, ".pi", "runs"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "runs", "dev.log"), "$ npm run dev\nready\n");
  clear();
  send({ type: "open_code", path: ".pi/runs/dev.log" });
  const first = await want("code");
  assert.equal(first.text, "$ npm run dev\nready\n");
  clear();
  appendFileSync(join(cwd, ".pi", "runs", "dev.log"), "listening on 4000\n");
  await want("code", (m) => m.text.endsWith("listening on 4000\n"));
  send({ type: "close_code" });
  writeFileSync(join(cwd, ".pi", "settings.json"), "{}");
  clear();
  send({ type: "open_code", path: ".pi/settings.json" });
  assert.equal((await want("code_gone")).reason, "missing", "앱의 나머지는 여전히 앱의 것이다");
  send({ type: "close_code" });
});

it("읽을 것이 없으면 없다고 말한다 — 없는 파일, 글자가 아닌 파일, git의 것", async () => {
  clear();
  send({ type: "open_code", path: "nothing-here.ts" });
  assert.equal((await want("code_gone")).reason, "missing");

  writeFileSync(join(cwd, "icon.bin"), Buffer.from([0x01, 0x00, 0x02]));
  clear();
  send({ type: "open_code", path: "icon.bin" });
  assert.equal((await want("code_gone")).reason, "binary");

  mkdirSync(join(cwd, ".git"), { recursive: true });
  writeFileSync(join(cwd, ".git", "config"), "[core]\n");
  clear();
  send({ type: "open_code", path: ".git/config" });
  assert.equal((await want("code_gone")).reason, "missing", "git의 것은 없는 것과 같이 말한다");
  send({ type: "close_code" });
});

it("노트를 열면 본문과 버전이 오고, pi가 손대지 않은 노트에는 결정할 것이 없다", async () => {
  clear();
  send({ type: "open_note", path: "a.md" });
  const note = await want("note");
  assert.equal(note.text, "# a\n\nfirst\n");
  assert.equal(typeof note.modified, "number");
  assert.equal(note.original, undefined, "pi의 미결정 변경이 없으면 before도 없다");
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
  assert.equal(changed.original, undefined, "내 저장은 결정할 것을 만들지 않는다");
});

it("서버가 한 말은 파일에도 남고, 탭은 그 파일이 어디인지 듣는다", async () => {
  // 붙는 탭마다 듣는 것이므로, 이 파일의 inbox를 건드리지 않고 새 탭 하나로 묻는다.
  const second = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const heard = [];
  second.onmessage = (e) => heard.push(JSON.parse(e.data));
  const config = await until("config", () => heard.find((m) => m.type === "config"));
  second.close();
  assert.equal(config.log, join(appDir, "logs", "server.log"), "탭이 들은 자리");
  const written = readFileSync(config.log, "utf8");
  assert.match(written, /open http:\/\/localhost/, "터미널에 한 말이 그대로");
  assert.match(written.split("\n")[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z /, "줄마다 언제인지가 앞에");
});

it("글자만 바뀐 저장은 목록을 다시 보내지 않는다 — 그러려고 폴더를 다시 읽지도 않는다", async () => {
  clear();
  send({ type: "open_note", path: "a.md" });
  const { modified } = await want("note");
  clear();
  send({ type: "save_note", path: "a.md", text: "# a\n\nfirst, then again\n", base: modified });
  await want("note_changed");
  // 목록이 온다면 그건 폴더를 다시 읽었다는 뜻이다 — 저장 한 번에 볼트 전체를 세는 일.
  assert.equal(inbox.find((m) => m.type === "files"), undefined, "달라진 것이 없으므로 보낼 것도 없다");
});

it("새 노트는 목록의 소식이다", async () => {
  clear();
  send({ type: "new_note" });
  const born = await want("note_created");
  const list = await want("files");
  assert.ok(list.files.some((f) => f.path === born.path), `${born.path}이 목록에 있다`);
  assert.equal(list.truncated, false, "이 폴더는 걸릴 만큼 크지 않다");
  clear();
  send({ type: "delete_note", path: born.path });
  await want("note_deleted");
  const after = await want("files");
  assert.equal(after.files.some((f) => f.path === born.path), false, "지운 것은 목록에서 빠진다");
});

it("잘라 붙인 글은 제 저자를 지닌 채 옮겨진다 — 로그의 길이가 어디서 왔는지의 기준이다", async () => {
  mkdirSync(join(cwd, ".pi/history"), { recursive: true });
  writeFileSync(join(cwd, "mv.md"), "aa PIPI bb\n");
  writeFileSync(join(cwd, ".pi/history/mv.md.jsonl"), [
    { author: "me", at: 1, from: 0, to: 0, inserted: "aa  bb\n", removed: "" },
    { author: "pi", at: 2, sessionId: "s", entryId: "e", from: 3, to: 3, inserted: "PIPI", removed: "" },
  ].map((c) => JSON.stringify(c)).join("\n") + "\n");
  clear();
  send({ type: "open_note", path: "mv.md" });
  const opened = await want("note", (m) => m.path === "mv.md");
  assert.equal(opened.lines, 2, "노트와 함께 로그의 길이가 온다");
  // The cut, saved on its own — the words leave the record's text.
  clear();
  send({ type: "save_note", path: "mv.md", text: "aa  bb\n", base: opened.modified, edits: [{ from: 3, to: 7, insert: "" }] });
  const cut = await want("note_changed", (m) => m.path === "mv.md");
  assert.equal(cut.lines, 3);
  // The paste, a save later, into another note: it names where the words were when the log was 2 long.
  writeFileSync(join(cwd, "dst.md"), "x\n");
  clear();
  send({ type: "open_note", path: "dst.md" });
  const dst = await want("note", (m) => m.path === "dst.md");
  clear();
  send({ type: "save_note", path: "dst.md", text: "x\nPIPI", base: dst.modified, edits: [{ from: 2, to: 2, insert: "PIPI", moved: { path: "mv.md", from: 3, to: 7, lines: 2 } }] });
  await want("note_changed", (m) => m.path === "dst.md");
  clear();
  send({ type: "who_wrote", path: "dst.md" });
  const who = await want("authors");
  // dst.md appeared while the app ran, so its own words are outside's (Phase A); the moved words are pi's, from the same conversation.
  assert.deepEqual(who.spans.map((s) => [s.from, s.to, s.author, s.session]), [[0, 2, "outside", undefined], [2, 6, "pi", "s"]], "다른 노트로 옮겨서도 pi의 글, 같은 대화");
});

it("저장은 편집기가 한 말대로 적힌다 — 글자 하나를 고치면 글자 하나", async () => {
  writeFileSync(join(cwd, "exact.md"), "hello world\n");
  clear();
  send({ type: "open_note", path: "exact.md" });
  const opened = await want("note", (m) => m.path === "exact.md");
  clear();
  send({ type: "save_note", path: "exact.md", text: "hello World\n", base: opened.modified, edits: [{ from: 6, to: 7, insert: "W" }] });
  const changed = await want("note_changed", (m) => m.path === "exact.md");
  assert.deepEqual(changed.changes.map((c) => [c.from, c.to, c.inserted, c.removed]), [[6, 7, "W", "w"]]);
  assert.deepEqual(history("exact.md").at(-1).inserted, "W");
  // An account that does not add up is set aside, and the change is read off the two texts.
  clear();
  send({ type: "save_note", path: "exact.md", text: "hello World!\n", base: changed.modified, edits: [{ from: 0, to: 0, insert: "wrong" }] });
  const again = await want("note_changed", (m) => m.path === "exact.md");
  assert.deepEqual(again.changes.map((c) => [c.inserted, c.removed]), [["!", ""]]);
});

it("앱 폴더는 뜨면서 git에 무엇을 남길지 적어 둔다", () => {
  const lines = readFileSync(join(cwd, ".pi/.gitignore"), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(lines, ["*.snapshot.json", "links.json", "trash/"]);
});

it("앱이 켜질 때 폴더에 있던 노트는 누구 것도 아니다 — 물어도 표시할 자리가 없다", async () => {
  // a.md는 서버가 뜨기 전부터 있었고, 아직 아무도 열지 않았다.
  clear();
  send({ type: "open_note", path: "a.md" });
  await want("note", (m) => m.path === "a.md");
  clear();
  send({ type: "who_wrote", path: "a.md" });
  const answer = await want("authors");
  assert.deepEqual(answer.spans, [], "앱 이전의 글은 밑줄이 없다");
  assert.equal(history("a.md")[0].author, "before");
});

it("누가 썼는지 물으면 남이 쓴 자리만 돌아온다", async () => {
  // 앱이 도는 동안 폴더에 나타난 노트: 폴더에 없던 것이니 통째로 바깥의 글이다.
  writeFileSync(join(cwd, "whose.md"), "outside wrote all of this\n");
  clear();
  send({ type: "open_note", path: "whose.md" });
  const opened = await want("note", (m) => m.path === "whose.md");
  clear();
  send({ type: "who_wrote", path: "whose.md" });
  const first = await want("authors");
  assert.equal(first.path, "whose.md");
  assert.deepEqual(first.spans.map((s) => [s.from, s.to, s.author]), [[0, opened.text.length, "outside"]]);

  // 그 뒤를 내가 이어 쓰면, 내 글은 답에 없다 — 노트는 대부분 제 주인의 것이므로.
  send({ type: "save_note", path: "whose.md", text: `${opened.text}and then I did\n`, base: opened.modified });
  await want("note_changed", (m) => m.path === "whose.md");
  clear();
  send({ type: "who_wrote", path: "whose.md" });
  const second = await want("authors");
  assert.deepEqual(second.spans.map((s) => s.author), ["outside"], "내 것은 표시할 것이 아니다");
  assert.equal(second.spans[0].to, opened.text.length, "바깥이 쓴 자리는 그대로");
});

it("한 자리를 짚으면 누가·언제·무엇을 대신해 썼는지가 온다", async () => {
  const mine = "# why\n\nmine.\n";
  const added = "pi wrote this.\n";
  writeFileSync(join(cwd, "why.md"), mine + added);
  mkdirSync(join(cwd, ".pi/history"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi/history/why.md.jsonl"),
    [
      { author: "me", at: 1, from: 0, to: 0, inserted: mine, removed: "" },
      { author: "pi", at: 2, sessionId: "no-such-session", entryId: "e7", from: mine.length, to: mine.length, inserted: added, removed: "old line.\n" },
    ]
      .map((c) => JSON.stringify(c))
      .join("\n") + "\n",
  );
  clear();
  send({ type: "open_note", path: "why.md" });
  await want("note", (m) => m.path === "why.md");
  clear();
  send({ type: "why_wrote", path: "why.md", pos: mine.length + 2 });
  const why = await want("why");
  assert.equal(why.author, "pi");
  assert.equal(why.at, 2);
  assert.equal(why.from, mine.length);
  assert.equal(why.text, added, "지금 그 자리에 있는 글");
  assert.equal(why.removed, "old line.\n", "그 자리에 있던 글");

  // 덧붙이기만 한 자리: 대신한 것이 "없다"는 것과 "모른다"는 것은 다르고, 빈 문자열이
  // 전자다. 이것이 오지 않으면 탭은 되돌릴 수 있는 것도 되돌릴 수 없다.
  const plain = "\nand pi added this too.\n";
  writeFileSync(join(cwd, "why.md"), mine + added + plain);
  appendFileSync(
    join(cwd, ".pi/history/why.md.jsonl"),
    JSON.stringify({ author: "pi", at: 3, sessionId: "s", entryId: "e8", from: (mine + added).length, to: (mine + added).length, inserted: plain, removed: "" }) + "\n",
  );
  clear();
  send({ type: "open_note", path: "why.md" });
  await want("note", (m) => m.path === "why.md");
  clear();
  send({ type: "why_wrote", path: "why.md", pos: (mine + added).length + 2 });
  const plainly = await want("why");
  assert.equal(plainly.removed, "", "대신한 것이 없다는 말이 온다 — 빠지지 않는다");
  assert.equal(why.entry, "e7", "어느 턴이었는지");
  // 그 대화는 이 기계에 없다: 모델과 질문은 빈 채로 오고, 나머지는 그대로 온다.
  assert.equal(why.model, undefined);
  assert.equal(why.prompt, undefined);

  // 내가 쓴 자리를 짚으면 그것도 말해준다 — 표시는 안 하지만 물어볼 수는 있다.
  clear();
  send({ type: "why_wrote", path: "why.md", pos: 2 });
  assert.equal((await want("why")).author, "me");
});

it("한 런이 쓴 노트들은 한 번에 되돌아간다 — 결정한 것과 내가 쓴 것은 빼고", async () => {
  // pi의 런 하나(세션 s, 시각 1000~2000)가 노트 셋을 썼다. 첫째는 아직 결정 전, 둘째는 이미 Keep했고,
  // 셋째는 pi가 쓴 뒤 내가 이어 썼다. 넷째는 다른 런의 것이다.
  mkdirSync(join(cwd, ".pi/history"), { recursive: true });
  const plant = (name, lines, text) => {
    writeFileSync(join(cwd, name), text);
    writeFileSync(join(cwd, `.pi/history/${name}.jsonl`), lines.map((c) => JSON.stringify(c)).join("\n") + "\n");
  };
  const pi = (at, from, inserted, removed = "") => ({ author: "pi", at, sessionId: "s", entryId: "e", from, to: from + removed.length, inserted, removed });
  plant("run-a.md", [{ author: "me", at: 1, from: 0, to: 0, inserted: "a\n", removed: "" }, pi(1500, 2, "pi a\n")], "a\npi a\n");
  plant("run-b.md", [{ author: "me", at: 1, from: 0, to: 0, inserted: "b\n", removed: "" }, pi(1500, 2, "pi b\n"), { author: "me", at: 1600, from: 2, to: 7, inserted: "pi b\n", removed: "pi b\n", kept: true }], "b\npi b\n");
  plant("run-c.md", [{ author: "me", at: 1, from: 0, to: 0, inserted: "c\n", removed: "" }, pi(1500, 2, "pi c\n"), { author: "me", at: 1700, from: 7, to: 7, inserted: "mine after\n", removed: "" }], "c\npi c\nmine after\n");
  plant("run-d.md", [{ author: "me", at: 1, from: 0, to: 0, inserted: "d\n", removed: "" }, pi(5000, 2, "pi d\n")], "d\npi d\n");
  clear();
  send({ type: "undo_run", session: "s", from: 1000, to: 2000 });
  const undone = await want("run_undone");
  assert.deepEqual(undone.notes.sort(), ["run-a.md", "run-c.md"]);
  assert.equal(readFileSync(join(cwd, "run-a.md"), "utf8"), "a\n", "결정 전의 것은 돌아간다");
  assert.equal(readFileSync(join(cwd, "run-b.md"), "utf8"), "b\npi b\n", "Keep한 것은 내 결정이라 남는다");
  assert.equal(readFileSync(join(cwd, "run-c.md"), "utf8"), "c\nmine after\n", "pi의 글만 가고 내 글은 남는다");
  assert.equal(readFileSync(join(cwd, "run-d.md"), "utf8"), "d\npi d\n", "다른 런은 건드리지 않는다");
  assert.equal(history("run-a.md").at(-1).author, "me", "되돌린 것은 내 편집으로 적힌다");
  // 다시 누르면 남은 것이 없다.
  clear();
  send({ type: "undo_run", session: "s", from: 1000, to: 2000 });
  assert.deepEqual((await want("run_undone")).notes, []);
});

it("결정할 것을 담지 못하는 자리의 결정은 거절되고, 노트가 되돌아온다", async () => {
  // pi가 쓴 자리가 있는 노트. 장부를 직접 놓는 것은 pi 없이 그 상태를 만드는 유일한 방법이고,
  // 며칠 뒤에 노트를 여는 사람이 보는 상태이기도 하다.
  const mine = "# whose\n\nmine.\n";
  const added = "\npi wrote this.\n";
  writeFileSync(join(cwd, "decide.md"), mine + added);
  mkdirSync(join(cwd, ".pi/history"), { recursive: true });
  const log = join(cwd, ".pi/history/decide.md.jsonl");
  writeFileSync(
    log,
    [
      { author: "me", at: 1, from: 0, to: 0, inserted: mine, removed: "" },
      { author: "pi", at: 2, sessionId: "s", entryId: "e", from: mine.length, to: mine.length, inserted: added, removed: "" },
    ]
      .map((c) => JSON.stringify(c))
      .join("\n") + "\n",
  );
  clear();
  send({ type: "open_note", path: "decide.md" });
  const opened = await want("note", (m) => m.path === "decide.md");
  assert.ok(opened.original, "결정할 것이 있다");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const was = lines();

  // 탭이 한 글자 앞서 있을 때 보내는 모양: 같은 범위, 전부 한 칸씩 밀림.
  clear();
  send({ type: "accept_note", path: "decide.md", from: mine.length + 1, to: mine.length + added.length + 1, kept: true });
  const back = await want("note", (m) => m.path === "decide.md");
  assert.ok(back.original, "결정할 것은 그대로 남아 있다 — 화면도 그렇게 그린다");
  assert.equal(lines(), was, "장부에는 아무것도 적히지 않는다");

  // 맞는 자리로 보내면 결정된다.
  clear();
  send({ type: "accept_note", path: "decide.md", from: mine.length, to: mine.length + added.length, kept: true });
  const done = await want("note_changed", (m) => m.path === "decide.md");
  assert.equal(done.original, undefined, "더 결정할 것이 없다");
  assert.equal(lines(), was + 1, "결정 한 줄만 늘었다");
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

it("pi가 쓴 노트는 before와 함께 오고, 받아들이면 글은 그대로인 채 결정할 것이 사라진다", async () => {
  // Seed a note pi wrote in, by the log's own format.
  writeFileSync(join(cwd, "p.md"), "pi wrote this\n");
  writeFileSync(join(cwd, ".pi/history/p.md.jsonl"), JSON.stringify({ author: "pi", at: 1, sessionId: "s", entryId: "e", from: 0, to: 0, inserted: "pi wrote this\n", removed: "" }) + "\n");
  clear();
  send({ type: "open_note", path: "p.md" });
  const note = await want("note", (m) => m.path === "p.md");
  assert.equal(note.original, "", "pi가 쓰기 전에는 아무것도 없었다 — 빈 문자열이지 없음이 아니다");
  clear();
  send({ type: "accept_note", path: "p.md", from: 0, to: 14 });
  const changed = await want("note_changed", (m) => m.path === "p.md");
  assert.deepEqual(changed.changes, []);
  assert.equal(changed.original, undefined, "결정하고 나면 before는 없다");
  assert.equal(readFileSync(join(cwd, "p.md"), "utf8"), "pi wrote this\n");
  assert.equal(history("p.md").at(-1).kept, true);
});

it("없던 노트는 base가 null일 때 만들어져 통째로 오고, 목록에 오른다", async () => {
  clear();
  send({ type: "save_note", path: "new/one.md", text: "new\n", base: null });
  const note = await want("note", (m) => m.path === "new/one.md");
  assert.equal(note.original, undefined);
  const files = await want("files", (m) => m.files.some((f) => f.path === "new/one.md"));
  assert.equal(files.files[0].path, "new/one.md", "새 것이 맨 위");
});

it("새 노트를 청하면 Untitled로 만들어져 이 탭에 이름이 오고, 두 번째는 번호가 붙는다", async () => {
  clear();
  send({ type: "new_note" });
  const first = await want("note_created");
  assert.equal(first.path, "Untitled.md");
  // A note made here says when it was made, and nothing else — see withCreated in vault.ts.
  assert.match(readFileSync(join(cwd, first.path), "utf8"), /^---\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}\n---\n$/);
  await want("note", (m) => m.path === first.path);
  await want("files", (m) => m.files.some((f) => f.path === first.path));
  clear();
  send({ type: "new_note" });
  assert.equal((await want("note_created")).path, "Untitled 2.md");
});

it("새 노트에 이름과 첫 글을 함께 주면 그대로 만들어진다", async () => {
  clear();
  send({ type: "new_note", name: "Welcome to Octave", text: "# Welcome\n\nHello.\n" });
  const made = await want("note_created");
  assert.equal(made.path, "Welcome to Octave.md");
  assert.match(readFileSync(join(cwd, made.path), "utf8"), /^---\ncreated: [^\n]+\n---\n# Welcome\n\nHello\.\n$/);
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
  assert.match(readFileSync(join(cwd, "wanted.md"), "utf8"), /^---\ncreated: /);
  clear();
  send({ type: "new_note", name: "wanted" });
  assert.equal((await want("note_rename_failed")).reason, "exists");
});

it("노트를 열면 같은 태그의 노트가 오고, 다른 노트의 태그가 바뀌면 다시 온다", async () => {
  writeFileSync(join(cwd, "tag-a.md"), "#shared one\n");
  writeFileSync(join(cwd, "tag-b.md"), "#shared two\n");
  await new Promise((r) => setTimeout(r, 400)); // the watcher's reports
  clear();
  send({ type: "open_note", path: "tag-a.md" });
  const note = await want("note", (m) => m.path === "tag-a.md");
  assert.deepEqual(note.tagged, [{ path: "tag-b.md", tags: ["shared"] }]);
  // The other note drops the tag: this one hears its list again, now empty.
  clear();
  send({ type: "open_note", path: "tag-b.md" });
  const b = await want("note", (m) => m.path === "tag-b.md");
  clear();
  send({ type: "save_note", path: "tag-b.md", text: "#other two\n", base: b.modified });
  const again = await want("tagged", (m) => m.path === "tag-a.md");
  assert.deepEqual(again.notes, []);
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

it("고른 자리가 없는 노트나 노트 밖이면 묻지 않고 이 탭에만 답한다", async () => {
  writeFileSync(join(cwd, "range.md"), "짧다\n");
  clear();
  send({ type: "prompt", text: "이게 뭐지", ask: { id: 8, path: "nope.md", from: 0, to: 3 } });
  assert.equal((await want("ask_done", (m) => m.id === 8)).outcome, "gone");
  clear();
  send({ type: "prompt", text: "이게 뭐지", ask: { id: 9, path: "range.md", from: 0, to: 9999 } });
  assert.equal((await want("ask_done", (m) => m.id === 9)).outcome, "gone");
});

// The one test here that spends a model call: everything before it is the
// server on its own. What it pins is the whole of the wiring — the question
// pi is sent, where the answer lands, and that the place survives the person
// typing while pi thinks — so it earns the call.
it("고른 부분을 물으면 답이 그 아래에 pi의 글로 들어오고, 기다리는 동안 위를 고쳐도 자리를 지킨다", async (t) => {
  const chosen = "고양이는 밤에 잘 본다";
  writeFileSync(join(cwd, "ask.md"), `머리말\n\n${chosen}\n\n맺음말\n`);
  clear();
  send({ type: "open_note", path: "ask.md" });
  const note = await want("note", (m) => m.path === "ask.md");
  const from = note.text.indexOf(chosen);
  clear();
  send({ type: "prompt", text: "왜 그런지 한 문장으로 알려줘.", note: "ask.md", ask: { id: 7, path: "ask.md", from, to: from + chosen.length } });
  // 답을 기다리는 동안 고른 글 위를 고친다: 자리가 뒤로 밀린다.
  send({ type: "save_note", path: "ask.md", text: note.text.replace("머리말", "머리말을 더 길게 고쳐 썼다"), base: note.modified });
  await want("note_changed", (m) => m.path === "ask.md" && m.changes.some((c) => c.author === "me"));
  const done = await want("ask_done", (m) => m.id === 7, 180_000);
  // A model that would not answer is about the machine, like the credentials
  // this whole file skips on — and it does not answer in one shape but two.
  // A provider that refuses the call sends a message back that stopped on an
  // error; a machine with no key for the model never gets that far, and what
  // the tab is told instead is the server's own error. The second shape is
  // what a runner with no ~/.pi/agent/auth.json produces, and asserting
  // through it made the light red for the machine rather than for the code.
  const refused = inbox.find((m) => m.type === "message_end" && m.message?.stopReason === "error");
  const unanswerable = refused ?? inbox.find((m) => m.type === "error");
  if (done.outcome !== "written" && unanswerable) {
    const why = refused ? String(refused.message.errorMessage) : String(unanswerable.message);
    t.diagnostic(`모델이 답하지 못했다 — ${why.slice(0, 160)}`);
    return t.skip("이 기계의 모델이 답하지 못했다");
  }
  assert.equal(done.outcome, "written");
  const text = readFileSync(join(cwd, "ask.md"), "utf8");
  assert.ok(text.includes("머리말을 더 길게 고쳐 썼다"), "그 사이의 내 편집은 그대로 있다");
  const under = text.slice(text.indexOf(chosen) + chosen.length, text.indexOf("맺음말"));
  assert.ok(under.trim().length > 0, "답은 고른 문장과 다음 문단 사이에 들어간다");
  assert.match(under, /^\n\n/, "제 문단으로 들어간다");
  const last = history("ask.md").at(-1);
  assert.equal(last.author, "pi");
  assert.ok(last.sessionId && last.entryId, "어느 대화의 어느 턴이 쓴 것인지 남는다");
  assert.equal(readFileSync(join(cwd, "ask.md"), "utf8").includes("> "), false, "인용은 질문에만 있고 노트에는 안 들어간다");
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

it("속성의 타입을 고르면 모두에게 알려지고 .pi/properties.json에 남는다; 예약된 이름은 거부된다", async () => {
  clear();
  send({ type: "set_property_type", name: "Pages", propertyType: "number" });
  const types = await want("property_types", (m) => m.types.pages === "number");
  assert.deepEqual(types.types, { pages: "number" });
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi/properties.json"), "utf8")), { types: { pages: "number" } });
  clear();
  send({ type: "set_property_type", name: "tags", propertyType: "text" });
  const err = await want("error");
  assert.match(err.message, /tags/);
  send({ type: "set_property_type", name: "pages", propertyType: null });
  await want("property_types", (m) => !("pages" in m.types));
});

// Spends the start of a model call, and aborts it as soon as the question is
// on record. What it pins is that the question went as typed: pi's prompt()
// reads a leading "/" as a command — /curator is one pi-web-access registers —
// and would have run it instead of asking, with nothing on screen to say so.
it("/로 시작하는 글은 명령이 아니라 글로 보내진다", async () => {
  clear();
  send({ type: "prompt", text: "/curator" });
  const started = await want("message_start", (m) => m.message?.role === "user", 30_000);
  assert.equal(started.message.content.find((c) => c.type === "text")?.text, "/curator");
  send({ type: "abort" });
  await want("agent_settled", () => true, 30_000);
});

// /curator is pi-web-access's, and "bogus" is not one of its options: the
// extension says so through ctx.ui.notify, which is the whole path this pins —
// a command chosen from the list runs, and what it says arrives in the
// conversation. No model is asked.
it("목록에서 고른 명령은 실행되고, 확장이 하는 말은 대화에 들어온다", async () => {
  clear();
  send({ type: "prompt", text: "/curator bogus", command: true });
  const said = await want("error", (m) => /Unknown option: bogus/.test(m.message));
  assert.ok(said);
  assert.ok(!inbox.some((m) => m.type === "message_start"), "nothing was sent to the model");
});


// A one-pixel PNG, which is enough to see it arrive: the question is on
// record with the image beside the words, in the shape pi keeps images in.
// Aborted as soon as it is, like the "/" test above.
it("붙여넣은 이미지는 글과 함께 pi에 간다", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  clear();
  send({ type: "prompt", text: "what colour is this?", images: [{ data: png, mimeType: "image/png" }] });
  const started = await want("message_start", (m) => m.message?.role === "user", 30_000);
  const image = started.message.content.find((c) => c.type === "image");
  assert.ok(image, "an image part beside the text");
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.data, png);
  send({ type: "abort" });
  await want("agent_settled", () => true, 30_000);
});

it("압축을 손으로 시키면 pi가 하고, 할 것이 없으면 그렇다고 말한다", async () => {
  clear();
  send({ type: "compact" });
  // Either pi compacts (the conversation draws its start) or refuses because
  // there is too little to compact; both are the request reaching pi.
  const answered = await until("pi to answer", () => inbox.find((m) => m.type === "compaction_start" || m.type === "error"), 60_000);
  assert.ok(answered);
  if (answered.type === "compaction_start") await want("compaction_end", () => true, 120_000);
});

it("내보내기는 vault의 .pi/exports에 파일을 쓰고, 어디에 썼는지 대화에 말한다", async () => {
  // From an empty session, whatever the tests above left: the answer is
  // then the same whichever tests ran before this one.
  clear();
  send({ type: "new_session" });
  await want("snapshot", (m) => m.items.length === 0, 30_000);
  clear();
  send({ type: "export_session", format: "jsonl" });
  const said = await want("notice", (m) => /Session exported to /.test(m.text));
  const path = said.text.replace("Session exported to ", "");
  assert.ok(path.startsWith(join(cwd, ".pi/exports/")), path);
  assert.ok(existsSync(path), "the file is there");
  // HTML is pi's page of the conversation, and of an empty one pi makes
  // none: its refusal is what is shown, in its words.
  clear();
  send({ type: "export_session", format: "html" });
  assert.match((await want("error")).message, /Nothing to export yet/);
});

it("복제하면 지금 가지가 통째로 든 새 세션이 열리고, 원래 세션은 그대로 남는다; 빈 세션은 복제할 것이 없다", async (t) => {
  // The tests above leave a session with messages; the export test moved off
  // it, so find it and open it again.
  clear();
  send({ type: "new_session" });
  const listed = await want("sessions", () => true, 30_000);
  const source = listed.sessions.find((s) => !s.current && s.messageCount > 0);
  if (!source) return t.skip("no earlier session with messages — run the whole file");
  clear();
  send({ type: "resume_session", path: source.path });
  const before = await want("snapshot", (m) => m.items.some((i) => i.kind === "user"));
  const count = (await want("sessions")).sessions.length;
  clear();
  send({ type: "clone_session" });
  const after = await want("sessions", (m) => m.sessions.length === count + 1, 30_000);
  const clone = after.sessions.find((s) => s.current);
  assert.notEqual(clone.path, source.path, "a new session is open");
  assert.ok(after.sessions.some((s) => s.path === source.path), "the original is still there");
  const copied = await want("snapshot");
  assert.deepEqual(
    copied.items.filter((i) => i.kind === "user").map((i) => i.text),
    before.items.filter((i) => i.kind === "user").map((i) => i.text),
    "the same questions, in the same order",
  );
  // And a session with nothing in it has nothing to clone: pi refuses, in
  // its own words, before anything here has to.
  clear();
  send({ type: "new_session" });
  await want("snapshot", (m) => m.items.length === 0, 30_000);
  clear();
  send({ type: "clone_session" });
  assert.match((await want("error")).message, /has not been saved yet/);
});
it("갈래를 만들면 그 질문까지를 가진 새 세션이 열리고 질문은 글로 돌아오며, 열린 세션은 지울 수 없고 다른 세션은 지워진다", async (t) => {
  // The session the tests above wrote to is the one to fork from, and later
  // the one to delete. A new session first: it moves off that one, and the
  // list that comes with it is the one to read.
  clear();
  send({ type: "new_session" });
  const listed = await want("sessions", () => true, 30_000);
  const older = listed.sessions.find((s) => !s.current && s.messageCount > 0);
  if (!older) return t.skip("no earlier session with messages — run the whole file");
  clear();
  send({ type: "resume_session", path: older.path });
  const snap = await want("snapshot", (m) => m.items.some((i) => i.kind === "user" && i.entryId));
  const question = snap.items.find((i) => i.kind === "user" && i.entryId);
  // A conversation with something in it exports as a page too.
  clear();
  send({ type: "export_session", format: "html" });
  const html = await want("notice", (m) => /\.html$/.test(m.text), 30_000);
  assert.ok(existsSync(html.text.replace("Session exported to ", "")), "the page is there");
  const before = (await want("sessions")).sessions.length;
  clear();
  send({ type: "fork", entryId: question.entryId });
  const back = await want("queue_cleared", () => true, 30_000);
  assert.equal(back.steering[0], question.text, "the question comes back as text");
  const after = await want("sessions", (m) => m.sessions.length === before + 1, 30_000);
  const forked = after.sessions.find((s) => s.current);
  assert.notEqual(forked.path, older.path, "a new session is open");
  // Deleting: not the open one, and yes the other.
  clear();
  send({ type: "delete_session", path: forked.path });
  assert.match((await want("error")).message, /cannot be deleted/);
  clear();
  send({ type: "delete_session", path: older.path });
  const gone = await want("sessions", (m) => !m.sessions.some((s) => s.path === older.path), 30_000);
  assert.ok(gone);
  assert.equal(existsSync(older.path), false, "the file is gone (to the bin, or unlinked)");
});

test("폴더의 PDF는 /vault/로 제 경로에서만, PDF로 나간다", async () => {
  mkdirSync(join(cwd, "papers"), { recursive: true });
  const bytes = readFileSync(join(root, "test/fixtures/three-pages.pdf"));
  writeFileSync(join(cwd, "papers/served paper.pdf"), bytes);
  const get = (path) => fetch(`http://127.0.0.1:${port}/vault/${path}`);
  const found = await get("papers/served%20paper.pdf");
  assert.equal(found.status, 200);
  assert.equal(found.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await found.arrayBuffer()).equals(bytes), true, "바이트 그대로");
  assert.equal((await get("served%20paper.pdf")).status, 404, "그림과 달리 이름만으로 찾아 주지는 않는다");
  assert.equal((await get("a.md")).status, 404, "노트는 이 길로 나가지 않는다");
  assert.equal((await get("..%2Fpapers%2Fserved%20paper.pdf")).status, 404);
  mkdirSync(join(cwd, ".pi/x"), { recursive: true });
  writeFileSync(join(cwd, ".pi/x/hidden.pdf"), bytes);
  assert.equal((await get(".pi/x/hidden.pdf")).status, 404, "앱의 폴더 안은 아니다");
});

// A file dropped on the app arrives as a name and its bytes — see attach.ts.
test("떨어뜨린 파일은 attachments/에 놓이고, PDF면 목록이 바로 듣는다 — 남의 페이지가 보낸 것은 아니다", async () => {
  const url = (name) => `http://127.0.0.1:${port}/api/attachment?name=${encodeURIComponent(name)}`;
  const post = (name, body, headers = { "content-type": "application/octet-stream" }) => fetch(url(name), { method: "POST", headers, body });
  clear();
  const saved = await post("dropped paper.pdf", readFileSync(join(root, "test/fixtures/three-pages.pdf")));
  assert.equal(saved.status, 201);
  assert.deepEqual(await saved.json(), { path: "attachments/dropped paper.pdf" });
  assert.ok(existsSync(join(cwd, "attachments/dropped paper.pdf")));
  const listed = await want("files", (m) => m.documents.includes("attachments/dropped paper.pdf"));
  assert.ok(!listed.files.some((f) => f.path.endsWith(".pdf")), "노트 목록에는 없다");
  assert.deepEqual(await (await post("dropped paper.pdf", "again")).json(), { path: "attachments/dropped paper 2.pdf" }, "같은 이름은 옆에");
  assert.equal((await post("run.sh", "x")).status, 415, "안 받는 종류");
  assert.equal((await post("../.pdf", "x")).status, 400, "쓸 수 없는 이름");
  assert.equal((await post("a.pdf", "")).status, 413, "빈 것");
  assert.equal((await post("a.pdf", "x", { "content-type": "text/plain" })).status, 415, "바이트라고 밝히지 않은 것 — 남의 페이지가 물어보지 않고 보낼 수 있는 모양");
  assert.equal((await post("a.pdf", "x", { "content-type": "application/octet-stream", origin: "https://elsewhere.example" })).status, 403, "다른 곳에서 온 것");
  assert.ok(!existsSync(join(cwd, "attachments/a.pdf")), "거절된 것은 쓰이지 않는다");
});

// Not `it`: none of this needs a model, and saving a setting is what a person
// without credentials does first. Last in the file, and on a socket of its own
// — a second window — since the checks above read what the first one was sent
// when it connected.
test("설정은 접속할 때 오고, 바꾼 칸만 디스크에 겹쳐 쓰이며, 다른 창도 결과를 듣는다", async () => {
  const other = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const heard = [];
  other.onmessage = (e) => heard.push(JSON.parse(e.data));
  const hear = (type, pred = () => true) => until(type, () => heard.find((m) => m.type === type && pred(m)));
  const url = `http://127.0.0.1:${port}/api/settings`;
  const post = (body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  try {
    const opened = await hear("settings");
    assert.deepEqual(opened.settings, await (await fetch(url)).json(), "접속 때 온 것이 디스크의 것");

    heard.length = 0;
    const loadout = ["anthropic/claude-fable-5", "openai/gpt-5.5"];
    const first = await post(JSON.stringify({ loadout }));
    assert.equal(first.status, 200);
    const answered = await first.json();
    assert.deepEqual(answered.settings.loadout, loadout);
    const told = await hear("settings");
    assert.deepEqual(told, answered, "바꾸지 않은 창도 같은 것을 듣는다 — 같은 번째의 쓰기로");
    assert.ok(told.revision.n > opened.revision.n, "접속 때 것보다 나중의 쓰기");
    assert.ok(await hear("config"), "피커가 새 목록을 받도록 config도 다시 간다");

    // A window that never saw that loadout changes the mode, and only the mode.
    const second = await (await post(JSON.stringify({ toolMode: "plan" }))).json();
    assert.equal(second.settings.toolMode, "plan");
    assert.deepEqual(second.settings.loadout, loadout, "다른 칸을 바꿔도 로드아웃은 그대로");
    assert.equal(second.revision.n, answered.revision.n + 1, "쓸 때마다 하나씩");
    assert.deepEqual(JSON.parse(readFileSync(join(appDir, "settings.json"), "utf8")), second.settings, "디스크에 있는 것이 답한 것");

    assert.equal((await post("{ 반쯤")).status, 400, "읽을 수 없는 몸통");
    assert.equal((await post("[1]")).status, 400, "객체가 아닌 몸통");
    assert.equal((await post(JSON.stringify({ toolMode: "execution" }))).status, 200);
  } finally {
    other.close();
  }
});

// --- the agent's specs: opened and saved like a note, with none of a note's record ---

/** A spec in the folder, written as the agent would write it: straight to the disk. */
const putSpec = (path, text) => {
  mkdirSync(join(cwd, path, ".."), { recursive: true });
  writeFileSync(join(cwd, path), text);
};
const specHistory = (path) => join(cwd, `.pi/history/${path}.jsonl`);

it("스펙은 노트처럼 열리지만, 저자 기록·백링크·태그 없이 제 종류로 온다", async () => {
  const path = ".octave/specs/open/requirements.md";
  putSpec(path, "# Requirements\n\n#tag [[a]]\n");
  clear();
  send({ type: "open_note", path });
  const spec = await want("note", (m) => m.path === path);
  assert.equal(spec.kind, "spec");
  assert.equal(spec.text, "# Requirements\n\n#tag [[a]]\n");
  assert.equal(typeof spec.modified, "number");
  assert.deepEqual(Object.keys(spec).sort(), ["kind", "modified", "path", "text", "type"], "로그와 링크가 줄 것은 하나도 없다");
  assert.equal(existsSync(specHistory(path)), false, "여는 것으로 기록이 생기지 않는다");
});

it("읽은 버전 위의 스펙 저장은 디스크에 닿고 모든 탭이 통째로 듣는다 — 기록도, 목록 소식도 없이", async () => {
  const path = ".octave/specs/save/requirements.md";
  putSpec(path, "first\n");
  clear();
  send({ type: "open_note", path });
  const { modified } = await want("note", (m) => m.path === path);
  clear();
  send({ type: "save_note", path, text: "first, then mine\n", base: modified, edits: [{ from: 5, to: 5, insert: ", then mine" }] });
  const saved = await want("note", (m) => m.path === path && m.text === "first, then mine\n");
  assert.equal(saved.kind, "spec");
  assert.ok(saved.modified > modified);
  assert.equal(readFileSync(join(cwd, path), "utf8"), "first, then mine\n");
  assert.equal(existsSync(specHistory(path)), false, "누가 썼는지 적지 않는다");
  // Long enough for the watcher's report of that write to have come and gone: it is the tabs' own version, so nothing more is said.
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(inbox.filter((m) => m.type === "note" && m.path === path).length, 1, "제 쓰기의 메아리는 소식이 아니다");
  assert.equal(inbox.find((m) => m.type === "note_changed" || m.type === "files"), undefined);
});

it("낡은 버전 위의 스펙 저장은 거절되고 아무것도 쓰지 않는다 — 에이전트의 글을 덮지 않는다", async () => {
  const path = ".octave/specs/stale/requirements.md";
  putSpec(path, "the agent's\n");
  clear();
  send({ type: "open_note", path });
  const { modified } = await want("note", (m) => m.path === path);
  clear();
  send({ type: "save_note", path, text: "mine\n", base: modified - 1 });
  const refused = await want("note_conflict", (m) => m.path === path);
  assert.equal(refused.modified, modified);
  assert.equal(readFileSync(join(cwd, path), "utf8"), "the agent's\n");
});

it("앱 밖에서 쓴 스펙은 모든 탭이 통째로 듣고, 지워지면 연 탭이 듣는다", async () => {
  const path = ".octave/specs/outside/requirements.md";
  putSpec(path, "before\n");
  clear();
  send({ type: "open_note", path });
  const { modified } = await want("note", (m) => m.path === path);
  clear();
  writeFileSync(join(cwd, path), "before, and the agent's\n");
  const changed = await want("note", (m) => m.path === path && m.text === "before, and the agent's\n");
  assert.equal(changed.kind, "spec");
  assert.ok(changed.modified >= modified);
  assert.equal(existsSync(specHistory(path)), false);
  clear();
  rmSync(join(cwd, path));
  await want("note_gone", (m) => m.path === path);
  clear();
  send({ type: "save_note", path, text: "put back\n", base: null });
  await want("note", (m) => m.path === path && m.text === "put back\n");
  assert.equal(readFileSync(join(cwd, path), "utf8"), "put back\n", "사라진 뒤 되돌려 놓을 수 있다");
});

it("스펙은 노트 목록에도 검색에도 들지 않고, 노트의 이름 바꾸기와 지우기는 스펙에 닿지 않는다", async () => {
  const path = ".octave/specs/apart/requirements.md";
  putSpec(path, "SPECONLYWORD\n");
  const other = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const heard = [];
  other.onmessage = (e) => heard.push(JSON.parse(e.data));
  try {
    const files = await until("files", () => heard.find((m) => m.type === "files"));
    assert.equal(files.files.some((f) => f.path.startsWith(".octave")), false);
  } finally {
    other.close();
  }
  clear();
  send({ type: "search_notes", query: "SPECONLYWORD", id: 9 });
  assert.deepEqual((await want("search_results", (m) => m.id === 9)).hits, []);
  clear();
  send({ type: "rename_note", path, to: ".octave/specs/apart/renamed.md" });
  assert.equal((await want("note_rename_failed", (m) => m.path === path)).reason, "invalid");
  send({ type: "delete_note", path });
  send({ type: "open_note", path });
  await want("note", (m) => m.path === path);
  assert.equal(readFileSync(join(cwd, path), "utf8"), "SPECONLYWORD\n", "그대로 있다");
});

it("스펙이 어디까지 왔는지 탭이 듣는다 — 문서가 써지면 대기, 승인하면 다음", async () => {
  putSpec(".octave/specs/waiting/requirements.md", "# Requirements\n");
  const said = await want("specs", (m) => m.specs.some((spec) => spec.name === "waiting"));
  const waiting = said.specs.find((spec) => spec.name === "waiting");
  assert.equal(waiting.approved, 0);
  assert.equal(waiting.waiting, "requirements.md", "쓰였고 승인은 없으니 기다린다");
  assert.equal(typeof waiting.waitingAt, "number", "언제 쓰였는지도 — 여럿이 기다릴 때 새것을 가린다");
  assert.deepEqual(waiting.written, ["requirements.md"], "디스크에 있는 문서가 무엇인지도");
  clear();
  // Approving writes the record beside the documents and nothing else, which
  // is the one change the tabs would otherwise never hear.
  approve(cwd, "waiting");
  const after = await want("specs", (m) => m.specs.find((spec) => spec.name === "waiting")?.waiting === null);
  assert.deepEqual(after.specs.find((spec) => spec.name === "waiting"), { name: "waiting", own: true, approved: 1, waiting: null, waitingAt: null, written: ["requirements.md"], tasks: null, results: [] });
  clear();
  // The next document, written on the approved one: waiting in its turn.
  putSpec(".octave/specs/waiting/design.md", "# Design\n");
  const next = await want("specs", (m) => m.specs.find((spec) => spec.name === "waiting")?.waiting === "design.md");
  assert.equal(next.specs.find((spec) => spec.name === "waiting").approved, 1);
});

it("작업이 어디까지 왔는지도 같은 메시지로 — tasks.md가 없으면 null, 칸이 체크되면 움직인다", async () => {
  putSpec(".octave/specs/count/requirements.md", "# Requirements\n");
  const none = await want("specs", (m) => m.specs.some((spec) => spec.name === "count"));
  assert.equal(none.specs.find((spec) => spec.name === "count").tasks, null, "tasks.md가 아직 없다");
  clear();
  putSpec(".octave/specs/count/tasks.md", "- [ ] 1. First\n- [ ] 2. Heading\n- [ ] 2.1 Second\n- [ ] 2.2 Third\n");
  const fresh = await want("specs", (m) => m.specs.find((spec) => spec.name === "count")?.tasks !== null);
  assert.deepEqual(fresh.specs.find((spec) => spec.name === "count").tasks, { total: 4, done: 0, cancelled: 0, next: "1" }, "칸 넷, 묶음 2의 것도");
  clear();
  // The box checked as the run's end checks it (spec.ts): the count moves.
  putSpec(".octave/specs/count/tasks.md", "- [x] 1. First\n- [ ] 2. Heading\n- [ ] 2.1 Second\n- [ ] 2.2 Third\n");
  const moved = await want("specs", (m) => m.specs.find((spec) => spec.name === "count")?.tasks?.done === 1);
  assert.deepEqual(moved.specs.find((spec) => spec.name === "count").tasks, { total: 4, done: 1, cancelled: 0, next: "2.1" });
});

it("승인이 풀려도 써진 문서는 써진 것이다 — 승인만으로는 알 수 없는 것", async () => {
  for (const doc of ["requirements.md", "design.md"]) {
    putSpec(`.octave/specs/back/${doc}`, `# ${doc}\n`);
    await want("specs", (m) => m.specs.find((spec) => spec.name === "back")?.waiting === doc);
    approve(cwd, "back");
  }
  // The tasks are written and not approved: never waiting, ready as they are.
  putSpec(".octave/specs/back/tasks.md", "# tasks.md\n");
  const all = await want("specs", (m) => m.specs.find((spec) => spec.name === "back")?.written.includes("tasks.md"));
  assert.equal(all.specs.find((spec) => spec.name === "back").approved, 2, "둘이 승인됐다");
  assert.equal(all.specs.find((spec) => spec.name === "back").waiting, null, "작업 목록은 기다리지 않는다");
  clear();
  // Back to the requirements: the approvals after it fall away, but the design
  // and the tasks are still on the disk and can still be read.
  putSpec(".octave/specs/back/requirements.md", "# requirements.md, changed\n");
  const back = await want("specs", (m) => m.specs.find((spec) => spec.name === "back")?.waiting === "requirements.md");
  const spec = back.specs.find((entry) => entry.name === "back");
  assert.equal(spec.approved, 0, "고친 문서와 그 뒤의 승인이 함께 풀린다");
  assert.deepEqual(spec.written, ["requirements.md", "design.md", "tasks.md"], "그래도 셋 다 써져 있다");
});

it("붙는 탭은 스펙이 어디까지 왔는지를 연결하자마자 듣는다", async () => {
  const other = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const heard = [];
  other.onmessage = (e) => heard.push(JSON.parse(e.data));
  try {
    const said = await until("specs", () => heard.find((m) => m.type === "specs"));
    assert.ok(said.specs.some((spec) => spec.name === "waiting"), `waiting among ${said.specs.map((spec) => spec.name).join(", ")}`);
  } finally {
    other.close();
  }
});

it("붙는 탭은 명령 목록에서 /spec을 듣는다 — 메뉴가 그것을 보여 준다", async () => {
  const other = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const heard = [];
  other.onmessage = (e) => heard.push(JSON.parse(e.data));
  try {
    const { commands } = await until("commands", () => heard.find((m) => m.type === "commands"));
    const found = commands.find((c) => c.name === "spec");
    assert.ok(found, `spec among ${commands.map((c) => c.name).join(", ")}`);
    assert.equal(found.source, "extension");
    assert.ok(found.description);
  } finally {
    other.close();
  }
});

// Last in the file: the run leaves a session of its own, and the tests above
// look for "the earlier session with messages".
//
// A session a command opens is the person's session too. /spec-run is the
// first thing in Octave to open one, and the mode was only ever set at
// startup and on the window's own "new session": the run came up on pi's
// own defaults instead, which include the shell — whatever the person had
// chosen. Asked on Plan, where the difference is plain, and aborted as soon
// as the tools have been seen.
it("작업이 도는 동안 탭은 어느 작업인지 듣는다 — 세션의 표식에서; 턴이 끝나면 null", async () => {
  const name = "running-check";
  const dir = join(cwd, ".octave/specs", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "requirements.md"), "# Requirements Document\n");
  writeFileSync(join(dir, "design.md"), "# Design Document\n");
  writeFileSync(join(dir, "tasks.md"), "# Implementation Plan\n\n- [ ] 1. Do the one thing\n- [ ] 2. Do the next\n");
  const { approve } = await import("../specApproval.ts");
  while (approve(cwd, name)) {}
  clear();
  try {
    // One task, not a queue: this folder is no repository, so an aborted
    // run still counts as done there and a queue would go on to the next
    // while the check after this one is asking for a session of its own.
    send({ type: "prompt", text: `/spec-run ${name} 1`, command: true });
    const running = await want("config", (m) => m.run !== null, 60_000);
    assert.deepEqual(running.run, { spec: name, task: "1", title: "Do the one thing", then: [] }, "무엇을 돌리는지, 뒤에 무엇이 남았는지");
    assert.equal(running.isStreaming, true);
    send({ type: "abort" });
    await want("agent_settled", () => true, 60_000);
    const rested = await want("config", (m) => m.isStreaming === false, 10_000);
    assert.equal(rested.run, null, "턴이 끝나면 실행이 아니다");
  } finally {
    rmSync(join(cwd, ".octave"), { recursive: true, force: true });
  }
});

it("명령이 연 세션도 사람이 고른 모드로 열린다 — Plan이면 셸도 쓰기도 없다", async () => {
  const name = "tools-check";
  const dir = join(cwd, ".octave/specs", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "requirements.md"), "# Requirements Document\n");
  writeFileSync(join(dir, "design.md"), "# Design Document\n");
  writeFileSync(join(dir, "tasks.md"), "# Implementation Plan\n\n- [ ] 1. Do the one thing\n");
  const { approve } = await import("../specApproval.ts");
  while (approve(cwd, name)) {}

  const setMode = async (toolMode) =>
    await fetch(`http://127.0.0.1:${port}/api/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolMode }) });
  clear();
  assert.equal((await setMode("plan")).status, 200);
  try {
    // Changing the setting tells every tab, current session and all; those have
    // to be out of the way before the run's own are read.
    await want("settings", (m) => m.settings?.toolMode === "plan", 10_000);
    await want("config", () => true, 10_000);
    clear();
    send({ type: "prompt", text: `/spec-run ${name}`, command: true });
    // The whole state, pushed once the session has been replaced: the first
    // config of that burst is what the run is on.
    await want("snapshot", () => true, 60_000);
    const config = inbox.find((m) => m.type === "config");
    assert.ok(config, "the tab was told what the new session is on");
    assert.ok(!config.activeTools.includes("bash"), `no shell among ${config.activeTools.join(", ")}`);
    assert.ok(!config.activeTools.includes("write"), `and no writing among ${config.activeTools.join(", ")}`);
    assert.ok(config.activeTools.includes("read"), "Plan is still Plan");
    send({ type: "abort" });
    await want("agent_settled", () => true, 60_000);
  } finally {
    await setMode("execution");
    rmSync(join(cwd, ".octave"), { recursive: true, force: true });
  }
});

// Last, because it makes the folder a repository for as long as it runs, and
// the checks above were written for a folder that is none.
it("워크스페이스가 시작한 스펙과 base에서 딸려온 스펙을 갈라 말한다", async () => {
  const { execFileSync } = await import("node:child_process");
  const git = (where, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: where, encoding: "utf8" }).trim();
  const origin = mkdtempSync(join(tmpdir(), "octave-origin-"));
  try {
    // main에 이미 합쳐진 스펙 하나 — 새 워크스페이스는 이것을 디스크에 가지고 시작한다.
    git(cwd, "init", "-q", "-b", "main");
    mkdirSync(join(cwd, ".octave/specs/from-main"), { recursive: true });
    writeFileSync(join(cwd, ".octave/specs/from-main/requirements.md"), "# Requirements Document\n");
    git(cwd, "add", "-A", "--", ".octave");
    git(cwd, "commit", "-q", "-m", "theirs");
    git(cwd, "clone", "-q", "--bare", cwd, join(origin, "origin.git"));
    git(cwd, "remote", "add", "origin", join(origin, "origin.git"));
    git(cwd, "fetch", "-q", "origin");
    git(cwd, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git(cwd, "checkout", "-q", "-b", "someone/started-here");
    // 이 워크스페이스에서 시작한 스펙.
    mkdirSync(join(cwd, ".octave/specs/started-here"), { recursive: true });
    writeFileSync(join(cwd, ".octave/specs/started-here/requirements.md"), "# Requirements Document\n");
    // 무엇이 base의 것인지는 git만 아는 사실이라 작업 결과와 같은 길로 다시 읽힌다
    // (server.ts loadResults) — 스펙이 바뀌고 한 박자 뒤.
    const told = await want("specs", (m) => m.specs.find((spec) => spec.name === "from-main")?.own === false, 15_000);
    assert.equal(told.specs.length, 2, "둘 다 폴더에 있고, 둘 다 말해진다");
    assert.equal(told.specs.find((spec) => spec.name === "started-here").own, true, "여기서 시작한 것만 이 워크스페이스의 일이다");
  } finally {
    rmSync(join(cwd, ".git"), { recursive: true, force: true });
    rmSync(join(cwd, ".octave"), { recursive: true, force: true });
    rmSync(origin, { recursive: true, force: true });
  }
});

it("작업이 무엇에 이르렀는지는 저장소의 역사에서 — 커밋의 트레일러로 찾아, 스펙마다", async () => {
  const { execFileSync } = await import("node:child_process");
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" }).trim();
  const dir = join(cwd, ".octave/specs/came-to");
  try {
    git("init", "-q", "-b", "main");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "requirements.md"), "# Requirements Document\n");
    const none = await want("specs", (m) => m.specs.some((spec) => spec.name === "came-to"), 10_000);
    assert.deepEqual(none.specs.find((spec) => spec.name === "came-to").results, [], "아직 돌린 작업이 없다");
    clear();
    // A task's end, as spec.ts makes it: the box, and then the commit that
    // says whose it is. From outside the app, as a run in the terminal is.
    writeFileSync(join(cwd, "came-to.js"), "export const x = 1;\nexport const y = 2;\n");
    writeFileSync(join(dir, "tasks.md"), "- [x] 1. Make it\n- [ ] 2. Test it\n");
    git("add", "-A", "--", ".octave", "came-to.js");
    git("commit", "-q", "-m", "Make it", "-m", "Spec: came-to\nTask: 1\nChecks: node --test — 3 passed");
    const told = await want("specs", (m) => m.specs.find((spec) => spec.name === "came-to")?.results.length === 1, 15_000);
    const [result] = told.specs.find((spec) => spec.name === "came-to").results;
    assert.equal(result.task, "1");
    assert.equal(result.title, "Make it");
    assert.equal(result.commit, git("rev-parse", "HEAD"));
    assert.equal(result.checks, "node --test — 3 passed");
    assert.deepEqual(result.files, [{ path: "came-to.js", added: 2, deleted: 0 }], "스펙 폴더의 것은 작업이 바꾼 것이 아니다");
    assert.deepEqual([result.added, result.deleted], [2, 0]);
  } finally {
    rmSync(join(cwd, ".git"), { recursive: true, force: true });
    rmSync(join(cwd, ".octave"), { recursive: true, force: true });
    rmSync(join(cwd, "came-to.js"), { force: true });
  }
});
