/**
 * The vault's own .pi/ — settings, skills, prompts, SYSTEM.md — is what pi
 * reads from a project it trusts. pi's SDK trusts without asking; Octave asks
 * pi's trust file, and a vault it has no answer for is not trusted. Two
 * servers, one per answer, each with its own agent dir so the trust file is
 * the test's and not the person's.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * A vault with a skill in its .pi/, and a server on it; `trust` writes pi's
 * answer first. What comes back is the first context_sources and the means
 * to go on talking to the server, and to stop it.
 */
async function boot(trust) {
  const cwd = mkdtempSync(join(tmpdir(), "trust-test-"));
  writeFileSync(join(cwd, "a.md"), "# a\n");
  mkdirSync(join(cwd, ".pi/skills/greet"), { recursive: true });
  writeFileSync(join(cwd, ".pi/skills/greet/SKILL.md"), "---\nname: greet\ndescription: says hello\n---\nSay hello.\n");
  const agentDir = mkdtempSync(join(tmpdir(), "trust-test-agent-"));
  const appDir = mkdtempSync(join(tmpdir(), "trust-test-app-"));
  if (trust !== undefined) writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [realpathSync(cwd)]: trust }));
  const port = await freePort();
  let log = "";
  const server = spawn(join(root, "node_modules/.bin/tsx"), ["server.ts"], {
    cwd: root,
    env: { ...process.env, WORKDIR: cwd, PORT: String(port), APP_DIR: appDir, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const exited = new Promise((resolve) => server.once("exit", () => resolve("exited")));
  const up = until("the server", () => fetch(`http://127.0.0.1:${port}/api/settings`).then((r) => r.ok).catch(() => false));
  if ((await Promise.race([up, exited])) === "exited") throw new Error(`server did not start:\n${log}`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
  await until("the socket", () => ws.readyState === 1);
  const sources = await until("context_sources", () => inbox.find((m) => m.type === "context_sources"));
  const stop = async () => {
    ws.close();
    if (server.exitCode === null) {
      server.kill("SIGINT");
      await new Promise((r) => { const t = setTimeout(() => { server.kill("SIGKILL"); r(); }, 5000); server.once("exit", () => { clearTimeout(t); r(); }); });
    }
    for (const dir of [cwd, agentDir, appDir]) rmSync(dir, { recursive: true, force: true });
  };
  const send = (m) => ws.send(JSON.stringify(m));
  const want = (type, pred = () => true) => until(type, () => inbox.find((m) => m.type === type && pred(m)));
  const clear = () => (inbox.length = 0);
  return { sources, cwd, agentDir, send, want, clear, stop };
}

test("a vault pi was never asked about is not trusted: its skill is left out, and the card is told", async () => {
  const { sources, stop } = await boot(undefined);
  assert.equal(sources.skills, 0);
  assert.equal(sources.untrusted, true);
  await stop();
});

test("a vault pi's terminal was told to trust is read as a project", async () => {
  const { sources, stop } = await boot(true);
  assert.equal(sources.skills, 1);
  assert.equal(sources.untrusted, false);
  await stop();
});

test("the switch trusts the folder on the spot — the skill is read, it is on the / list, pi's trust.json remembers — and untrusts it again", async () => {
  const { cwd, agentDir, send, want, clear, stop } = await boot(undefined);
  assert.equal((await want("config")).pi.projectTrust, "untrusted");
  clear();
  send({ type: "set_setting", setting: "projectTrust", value: true });
  const trusted = await want("context_sources", (m) => m.skills === 1);
  assert.equal(trusted.untrusted, false);
  assert.equal((await want("config", (m) => m.pi.projectTrust === "trusted")).pi.projectTrust, "trusted");
  const listed = await want("commands", (m) => m.commands.some((c) => c.name === "skill:greet"));
  assert.ok(listed);
  const remembered = JSON.parse(readFileSync(join(agentDir, "trust.json"), "utf8"));
  assert.equal(remembered[realpathSync(cwd)], true, "pi's own file, pi's own key");
  clear();
  send({ type: "set_setting", setting: "projectTrust", value: false });
  await want("context_sources", (m) => m.skills === 0 && m.untrusted === true);
  await want("config", (m) => m.pi.projectTrust === "untrusted");
  await stop();
});

test("reload reads what was added since the session began — a prompt template appears on the / list", async () => {
  const { cwd, send, want, clear, stop } = await boot(true);
  mkdirSync(join(cwd, ".pi/prompts"), { recursive: true });
  writeFileSync(join(cwd, ".pi/prompts/tidy.md"), "---\ndescription: tidy the note\n---\nTidy this note.\n");
  clear();
  send({ type: "reload" });
  const listed = await want("commands", (m) => m.commands.some((c) => c.name === "tidy" && c.source === "prompt"));
  assert.ok(listed);
  await stop();
});
