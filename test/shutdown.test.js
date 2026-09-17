/**
 * Being asked to stop.
 *
 * The server has one clean path out — the watcher stopped, the open questions
 * cancelled, the session disposed, the sockets closed — and for a while it was
 * reached only by SIGINT, which is what a terminal sends. The desktop shell
 * sends the other one: child.kill() is SIGTERM, whose default action is to end
 * the process where it stands. So ⌘Q never retired an extension or disposed a
 * session, and the only person whose quit was clean was the one running it
 * from a terminal.
 *
 * What this pins is the difference a signal handler makes, which is visible
 * from outside: a process that ran the path leaves by its own exit(0), and one
 * that did not is reported as killed by the signal.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`${signal}을 받으면 제 발로 나간다`, async (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "shutdown-test-"));
    // Its own settings and log, as every server a test starts: the person's are not a test's to write in.
    const appDir = mkdtempSync(join(tmpdir(), "shutdown-test-app-"));
    writeFileSync(join(cwd, "a.md"), "# a\n");
    const port = await freePort();
    const server = spawn(join(root, "node_modules/.bin/tsx"), ["server.ts"], {
      cwd: root,
      env: { ...process.env, WORKDIR: cwd, PORT: String(port), APP_DIR: appDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    server.stdout.on("data", (d) => (log += d));
    server.stderr.on("data", (d) => (log += d));
    const ended = new Promise((resolve) => server.once("exit", (code, sig) => resolve({ code, sig })));
    const up = until("the server", () => fetch(`http://127.0.0.1:${port}/api/settings`).then((r) => r.ok).catch(() => false));

    try {
      // No skip for a machine without pi's credentials: the server starts on
      // nothing and waits for a sign-in, and leaving is what is tested here.
      if ((await Promise.race([up, ended.then(() => "exited")])) === "exited") {
        throw new Error(`server did not start:\n${log}`);
      }
      server.kill(signal);
      // Long enough that a slow dispose is not read as a hang, short enough
      // that a hang is not read as a slow dispose. The shell waits three.
      const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
      const { code, sig } = await ended;
      clearTimeout(timer);
      assert.equal(sig, null, `${signal}에 그 자리에서 끝나지 않는다 — 제 종료 경로를 탄다`);
      assert.equal(code, 0);
    } finally {
      if (server.exitCode === null) server.kill("SIGKILL");
      rmSync(cwd, { recursive: true, force: true });
      rmSync(appDir, { recursive: true, force: true });
    }
  });
}
