import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRuns } from "../electron/runs.js";

const folder = () => mkdtempSync(join(tmpdir(), "octave-runs-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("a run is started with its port, only one at a time in a folder, and stopped with what it started", async () => {
	const cwd = folder();
	const changes = [];
	const runs = createRuns({ onChange: (workdir, state) => changes.push({ workdir, ...state }), graceMs: 500 });
	try {
		const started = runs.start(cwd, { id: "dev", command: "echo port $OCTAVE_PORT; sleep 30 & wait", port: 4321, env: process.env });
		assert.deepEqual(started, { running: true, id: "dev", port: 4321, exit: null });
		assert.deepEqual(runs.start(cwd, { id: "dev", command: "echo again", port: 4321, env: process.env }), started, "a second start is the first's state");
		await sleep(300);
		await runs.stop(cwd);
		assert.deepEqual(runs.stateOf(cwd), { running: false, id: null, port: null, exit: null }, "stopped on purpose is not an ending to remember");
		assert.deepEqual(changes, [{ workdir: cwd, running: true, id: "dev", port: 4321, exit: null }, { workdir: cwd, running: false, id: null, port: null, exit: null }]);
		const log = readFileSync(join(cwd, ".pi", "runs", "dev.log"), "utf8");
		assert.match(log, /^\$ echo port \$OCTAVE_PORT; sleep 30 & wait\nport 4321\n\(exit \d+\)\n$/);
	} finally {
		await runs.stopAll();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("a run that ends on its own is remembered by its exit code, until the next start", async () => {
	const cwd = folder();
	const states = [];
	const runs = createRuns({ onChange: (_workdir, state) => states.push(state) });
	try {
		runs.start(cwd, { id: "dev", command: "echo 'address in use' >&2; exit 3", port: 1, env: process.env });
		for (let i = 0; i < 50 && runs.stateOf(cwd).running; i++) await sleep(50);
		assert.deepEqual(runs.stateOf(cwd), { running: false, id: "dev", port: null, exit: 3 });
		assert.match(readFileSync(join(cwd, ".pi", "runs", "dev.log"), "utf8"), /address in use\n\(exit 3\)\n$/);
		runs.start(cwd, { id: "dev", command: "sleep 30", port: 1, env: process.env });
		assert.equal(runs.stateOf(cwd).exit, null);
		await runs.stopAll();
		assert.equal(runs.stateOf(cwd).running, false);
	} finally {
		await runs.stopAll();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("one that will not stop when asked is made to, after the grace", async () => {
	const cwd = folder();
	const runs = createRuns({ onChange: () => {}, graceMs: 300 });
	try {
		runs.start(cwd, { id: "dev", command: "trap '' TERM; sleep 30 & wait", port: 1, env: process.env });
		await sleep(200);
		const at = Date.now();
		await runs.stop(cwd);
		assert.ok(Date.now() - at < 5000, "not the whole sleep");
		assert.equal(runs.stateOf(cwd).running, false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
