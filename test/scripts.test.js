import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NOT_STARTED, TIMED_OUT, runScript } from "../electron/scripts.js";

const folder = () => mkdtempSync(join(tmpdir(), "octave-scripts-"));

test("a command runs in the workspace, in the shell's environment, and its tail is logged with how it ended", async () => {
	const cwd = folder();
	try {
		const ran = await runScript({ name: "setup", command: "pwd; echo $OCTAVE_REPOSITORY; echo done", cwd, env: { ...process.env, OCTAVE_REPOSITORY: "/repo" }, timeout: 10 });
		assert.deepEqual(ran, { exit: 0, last: "done" });
		const log = readFileSync(join(cwd, ".pi", "runs", "setup.log"), "utf8");
		assert.match(log, /^\$ pwd; echo \$OCTAVE_REPOSITORY; echo done\n/);
		assert.match(log, /\n\/repo\ndone\n\(exit 0\)\n$/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("one that fails answers its exit code and the last line it printed, stderr included", async () => {
	const cwd = folder();
	try {
		const ran = await runScript({ name: "setup", command: "echo starting; echo 'no such tool' >&2; exit 3", cwd, env: process.env, timeout: 10 });
		assert.deepEqual(ran, { exit: 3, last: "no such tool" });
		assert.match(readFileSync(join(cwd, ".pi", "runs", "setup.log"), "utf8"), /\(exit 3\)\n$/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("one that outlives its time is stopped, and says so", async () => {
	const cwd = folder();
	try {
		const ran = await runScript({ name: "archive", command: "echo waiting; sleep 30", cwd, env: process.env, timeout: 1 });
		assert.deepEqual(ran, { exit: TIMED_OUT, last: "(stopped after 1s)" });
		assert.match(readFileSync(join(cwd, ".pi", "runs", "archive.log"), "utf8"), /waiting\n\(stopped after 1s\)\n\(exit 124\)\n$/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("a workspace that is gone is a command that could not start, not a throw", async () => {
	const ran = await runScript({ name: "setup", command: "true", cwd: "/nowhere/at/all", env: process.env, timeout: 10 });
	assert.equal(ran.exit, NOT_STARTED);
	assert.match(ran.last, /ENOENT/);
});
