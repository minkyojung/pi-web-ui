/**
 * The extensions installed for the person's own pi load here as they load
 * there: a tool of theirs is on the tool list, a command of theirs on the /
 * list — and one of theirs with the name of one of Octave's own does not
 * replace it, and says so. A server with its own agent dir holding one such
 * extension, so nothing on this machine's pi is involved.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const EXTENSION = `
export default function (pi) {
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    async execute(_id, params) { return { content: [{ type: "text", text: "Hello, " + params.name }], details: {} }; },
  });
  // The name of Octave's own question tool: this one must not replace it.
  pi.registerTool({
    name: "ask_user",
    label: "Ask (theirs)",
    description: "An ask_user that is not Octave's",
    parameters: { type: "object", properties: {} },
    async execute() { return { content: [{ type: "text", text: "theirs" }], details: {} }; },
  });
  pi.registerCommand("hello", { description: "Say hello", handler: async (_args, ctx) => { ctx.ui.notify("hello", "info"); } });
}
`;

async function boot(loadExtensions) {
  const cwd = mkdtempSync(join(tmpdir(), "ext-test-"));
  writeFileSync(join(cwd, "a.md"), "# a\n");
  const agentDir = mkdtempSync(join(tmpdir(), "ext-test-agent-"));
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(join(agentDir, "extensions", "theirs.js"), EXTENSION);
  const appDir = mkdtempSync(join(tmpdir(), "ext-test-app-"));
  if (loadExtensions !== undefined) writeFileSync(join(appDir, "settings.json"), JSON.stringify({ loadExtensions }));
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
  await until("the first state", () => inbox.some((m) => m.type === "snapshot"));
  const stop = async () => {
    ws.close();
    if (server.exitCode === null) {
      server.kill("SIGINT");
      await new Promise((r) => { const t = setTimeout(() => { server.kill("SIGKILL"); r(); }, 5000); server.once("exit", () => { clearTimeout(t); r(); }); });
    }
    for (const dir of [cwd, agentDir, appDir]) rmSync(dir, { recursive: true, force: true });
  };
  return { inbox, stop };
}

test("by default the person's extension loads: its tool is on the list, its command on the / list, and it is counted", async () => {
  const { inbox, stop } = await boot(undefined);
  try {
  const config = inbox.find((m) => m.type === "config");
  const names = config.tools.map((t) => t.name);
  assert.ok(names.includes("greet"), `greet among ${names.join(", ")}`);
  assert.equal(names.filter((n) => n === "ask_user").length, 1, "one ask_user, not two");
  const commands = inbox.find((m) => m.type === "commands").commands;
  assert.ok(commands.some((c) => c.name === "hello" && c.source === "extension"));
  assert.equal(inbox.find((m) => m.type === "context_sources").extensions, 1);
  // Their ask_user did not replace Octave's, and the conversation says so in pi's words.
  const said = inbox.find((m) => m.type === "error" && /Tool "ask_user" conflicts with <inline:ask>/.test(m.message));
  assert.ok(said, `the conflict is said: ${JSON.stringify(inbox.filter((m) => m.type === "error"))}`);
  const ours = config.tools.find((t) => t.name === "ask_user");
  assert.notEqual(ours.description, "An ask_user that is not Octave's", "the one kept is Octave's");
  } finally {
    await stop();
  }
});

test("with the switch off, nothing of theirs loads", async () => {
  const { inbox, stop } = await boot(false);
  try {
  const names = inbox.find((m) => m.type === "config").tools.map((t) => t.name);
  assert.equal(names.includes("greet"), false);
  assert.equal(inbox.find((m) => m.type === "context_sources").extensions, 0);
  assert.equal(inbox.some((m) => m.type === "error"), false, "and nothing to complain about");
  } finally {
    await stop();
  }
});
