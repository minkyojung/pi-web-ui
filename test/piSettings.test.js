/**
 * pi's own settings, switched from Octave: the switch calls pi's setter, pi's
 * settings.json is what changes, and every tab hears the new value. A server
 * with its own agent dir, so the person's real settings are not the ones
 * being flipped.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

let cwd, agentDir, appDir, server, port, ws, inbox, log = "";

test.before(async () => {
  cwd = mkdtempSync(join(tmpdir(), "pisettings-test-"));
  writeFileSync(join(cwd, "a.md"), "# a\n");
  agentDir = mkdtempSync(join(tmpdir(), "pisettings-test-agent-"));
  appDir = mkdtempSync(join(tmpdir(), "pisettings-test-app-"));
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
const piFile = () => JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));

test("pi의 설정이 pi의 기본값으로 온다 — 자동 압축은 켜져 있고, 문턱 둘은 pi의 숫자", async () => {
  const { pi } = await want("config");
  assert.deepEqual(pi.compaction, { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 });
});

test("자동 압축을 끄면 모두가 듣고 pi의 settings.json에 남는다; 켜면 되돌아온다", async () => {
  clear();
  send({ type: "set_setting", setting: "compaction.enabled", value: false });
  const off = await want("config", (m) => m.pi.compaction.enabled === false);
  assert.equal(off.pi.compaction.reserveTokens, 16384, "the thresholds are untouched");
  assert.equal(piFile().compaction.enabled, false, "pi's own file says so");
  clear();
  send({ type: "set_setting", setting: "compaction.enabled", value: true });
  await want("config", (m) => m.pi.compaction.enabled === true);
  assert.equal(piFile().compaction.enabled, true);
});

test("재시도와 thinking 숨김도 같은 길로 간다 — pi의 setter, pi의 파일, 모두에게 알림", async () => {
  const start = await want("config");
  assert.equal(start.pi.retryEnabled, true, "pi's default");
  assert.equal(start.pi.hideThinkingBlock, false, "pi's default");
  clear();
  send({ type: "set_setting", setting: "retry.enabled", value: false });
  await want("config", (m) => m.pi.retryEnabled === false);
  assert.equal(piFile().retry.enabled, false);
  clear();
  send({ type: "set_setting", setting: "hideThinkingBlock", value: true });
  await want("config", (m) => m.pi.hideThinkingBlock === true);
  assert.equal(piFile().hideThinkingBlock, true);
  clear();
  send({ type: "set_setting", setting: "retry.enabled", value: true });
  send({ type: "set_setting", setting: "hideThinkingBlock", value: false });
  await want("config", (m) => m.pi.retryEnabled === true && m.pi.hideThinkingBlock === false);
});

test("가지를 떠날 때 물을지는 pi의 파일에 pi의 키로 쓰이고, 카드의 세 번째 답이 그것을 끈다", async () => {
  const start = await want("config");
  assert.equal(start.pi.askBranchSummary, true, "pi's default is to ask");
  // The card comes before the move; its third answer turns the asking off.
  clear();
  send({ type: "navigate", entryId: "nowhere" });
  const card = await want("prompt_request");
  assert.deepEqual(card.prompt.options, ["No summary", "Summarize", "No summary, don't ask again"]);
  send({ type: "prompt_response", id: card.prompt.id, answer: "No summary, don't ask again" });
  await want("config", (m) => m.pi.askBranchSummary === false);
  assert.equal(piFile().branchSummary.skipPrompt, true, "pi's own key, in pi's own file");
  // Off, the arrows move without a card: the move itself fails on a made-up
  // target, which is the error and not a question.
  clear();
  send({ type: "navigate", entryId: "nowhere" });
  await until("an answer", () => inbox.find((m) => m.type === "error" || m.type === "prompt_request"));
  assert.equal(inbox.some((m) => m.type === "prompt_request"), false, "no card");
  // And the switch turns it back on.
  clear();
  send({ type: "set_setting", setting: "branchSummary.skipPrompt", value: false });
  await want("config", (m) => m.pi.askBranchSummary === true);
  assert.equal(piFile().branchSummary.skipPrompt, false);
  assert.equal(piFile().retry?.enabled ?? true, true, "the other keys in the file are kept");
});

test("모르는 설정이나 잘못된 값은 아무것도 바꾸지 않는다", async () => {
  clear();
  send({ type: "set_setting", setting: "compaction.enabled", value: "yes" });
  send({ type: "set_setting", setting: "nothing.here", value: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(inbox.some((m) => m.type === "config"), false, "no config went out");
  assert.equal(piFile().compaction.enabled, true);
});
