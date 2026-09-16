/**
 * Signing in and out, against the real server and the real pi, on a machine
 * with no credentials at all: its own empty agent directory, so nothing here
 * touches the person's ~/.pi. This is the first run a fresh install has, and
 * the one thing server.test.js cannot cover, since that one needs to be
 * signed in already.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

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

const until = async (what, get, ms = 30000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await get();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

let cwd, agentDir, appDir, server, port, log = "", ws, inbox;

test.before(async () => {
  cwd = mkdtempSync(join(tmpdir(), "signin-test-"));
  writeFileSync(join(cwd, "a.md"), "# a\n");
  agentDir = mkdtempSync(join(tmpdir(), "signin-test-agent-"));
  appDir = mkdtempSync(join(tmpdir(), "signin-test-app-"));
  port = await freePort();
  server = spawn(join(root, "node_modules/.bin/tsx"), ["server.ts"], {
    cwd: root,
    env: { ...process.env, WORKDIR: cwd, PORT: String(port), APP_DIR: appDir, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const exited = new Promise((resolve) => server.once("exit", () => resolve("exited")));
  const up = until("the server", () => fetch(`http://127.0.0.1:${port}/api/settings`).then((r) => r.ok).catch(() => false));
  if ((await Promise.race([up, exited])) === "exited") throw new Error(`server did not start:\n${log}`);
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
  for (const dir of [cwd, agentDir, appDir]) if (dir) rmSync(dir, { recursive: true, force: true });
});

const send = (m) => ws.send(JSON.stringify(m));
const want = (type, pred = () => true, ms) => until(type, () => inbox.find((m) => m.type === type && pred(m)), ms);
const clear = () => (inbox.length = 0);

test("자격이 하나도 없으면 모델도 없고, 제공자는 전부 로그인 전이다", async () => {
  const config = await want("config");
  assert.equal(config.model, null);
  assert.match(config.modelsNotice, /No provider is signed in/);
  const { providers } = await want("providers");
  assert.ok(providers.length > 0);
  assert.ok(providers.every((p) => p.signedIn === null));
});

test("잘못된 요청은 이 탭에 에러로 답한다 — 모르는 제공자, 그 제공자가 못 하는 방식", async () => {
  clear();
  send({ type: "login", provider: "nobody", method: "api_key" });
  const e1 = await want("error");
  assert.match(e1.message, /nobody cannot be signed in/);
  clear();
  send({ type: "login", provider: "openai", method: "oauth" });
  const e2 = await want("error");
  assert.match(e2.message, /openai cannot be signed in to with OAuth/);
});

test("API 키로 로그인: pi가 키를 묻고, 답하면 저장되고, 제공자는 로그인됨이 되고, 세션은 그 제공자의 모델에 오른다", async () => {
  clear();
  send({ type: "login", provider: "openai", method: "api_key" });
  const asked = await want("login_prompt");
  assert.equal(asked.prompt.provider, "openai");
  assert.equal(asked.prompt.type, "secret", "키는 가려서 입력받는다");
  send({ type: "login_answer", id: asked.prompt.id, value: "sk-test-not-a-real-key" });
  const done = await want("login_done");
  assert.deepEqual(done, { type: "login_done", provider: "openai", ok: true });
  const auth = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"));
  assert.equal(auth.openai.type, "api_key", "pi가 제 파일에 저장했다");
  const { providers } = await want("providers", (m) => m.providers.find((p) => p.id === "openai")?.signedIn);
  assert.deepEqual(providers.find((p) => p.id === "openai").signedIn, { method: "api_key", source: "stored" });
  const config = await want("config", (m) => m.model !== null);
  assert.match(config.model, /^openai\//, "모델 없던 세션이 그 제공자의 모델에 올랐다");
  assert.equal(config.modelsNotice, undefined, "빈 목록 안내는 사라졌다");
});

test("진행 중인 로그인을 취소하면 login_done은 ok도 error도 아니고, 다음 로그인을 받는다", async () => {
  clear();
  send({ type: "login", provider: "openai", method: "api_key" });
  const asked = await want("login_prompt");
  send({ type: "login_answer", id: asked.prompt.id, cancelled: true });
  const done = await want("login_done");
  assert.deepEqual(done, { type: "login_done", provider: "openai", ok: false });
});

test("로그아웃하면 pi가 키를 잊고, 제공자는 로그인 전으로 돌아간다", async () => {
  clear();
  send({ type: "logout", provider: "openai" });
  const { providers } = await want("providers", (m) => m.providers.find((p) => p.id === "openai")?.signedIn === null);
  assert.equal(providers.find((p) => p.id === "openai").signedIn, null);
  const auth = existsSync(join(agentDir, "auth.json")) ? JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8")) : {};
  assert.equal(auth.openai, undefined);
});
