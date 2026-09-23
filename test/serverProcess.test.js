import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createServerProcess } from "../electron/serverProcess.js";

/** A child process as far as the holder looks at one: it exits when killed, unless told to hang on SIGTERM. */
function fakeChild({ hangs = false } = {}) {
	const child = new EventEmitter();
	child.pid = 1;
	child.exitCode = null;
	child.signalCode = null;
	child.signals = [];
	child.kill = (signal = "SIGTERM") => {
		child.signals.push(signal);
		if (hangs && signal === "SIGTERM") return;
		child.exit(null, signal);
	};
	child.exit = (code, signal = null) => {
		child.exitCode = code;
		child.signalCode = signal;
		setImmediate(() => child.emit("exit", code, signal));
	};
	return child;
}

function holder(options = {}) {
	const started = [];
	const crashes = [];
	const server = createServerProcess({
		start: async (workdir) => {
			const child = fakeChild(options.child?.());
			started.push({ workdir, child });
			return { child, url: `http://127.0.0.1/${started.length}` };
		},
		onCrash: (code) => crashes.push(code),
		graceMs: 20,
		...options.overrides,
	});
	return { server, started, crashes };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("one server, however many folders ask for it at once, started for the first of them", async () => {
	const { server, started } = holder();
	const [a1, a2, b] = await Promise.all([server.get("/a"), server.get("/a"), server.get("/b")]);
	assert.equal(a1, a2);
	assert.equal(a1, b, "the second folder gets the same server, not one of its own");
	assert.deepEqual(started.map((s) => s.workdir), ["/a"]);
	assert.equal(server.up, true);
});

test("a server that exits on its own is a crash, and the next ask starts a new one", async () => {
	const { server, started, crashes } = holder();
	const first = await server.get("/a");
	started[0].child.exit(1);
	await tick();
	assert.deepEqual(crashes, [1]);
	assert.equal(server.up, false);
	const second = await server.get("/b");
	assert.notEqual(first, second);
	assert.deepEqual(started.map((s) => s.workdir), ["/a", "/b"], "started again for whoever asked");
});

test("a server that fails to start is not kept, so the next ask tries again", async () => {
	let fail = true;
	const server = createServerProcess({
		start: async () => {
			if (fail) throw new Error("no port");
			return { child: fakeChild(), url: "http://127.0.0.1/" };
		},
		onCrash: () => {},
	});
	await assert.rejects(server.get("/a"), /no port/);
	assert.equal(server.up, false);
	assert.equal(await server.current(), null);
	fail = false;
	assert.equal((await server.get("/a")).url, "http://127.0.0.1/");
});

test("stopping asks the server to stop and waits for it, and is not a crash", async () => {
	const { server, started, crashes } = holder();
	await server.get("/a");
	await server.stop();
	assert.deepEqual(started[0].child.signals, ["SIGTERM"]);
	assert.deepEqual(crashes, []);
	assert.equal(server.up, false);
});

test("a server that will not stop is killed outright", async () => {
	const { server, started } = holder({ child: () => ({ hangs: true }) });
	await server.get("/a");
	await server.stop();
	assert.deepEqual(started[0].child.signals, ["SIGTERM", "SIGKILL"]);
});

test("stopping waits for a server still starting, and stops it too", async () => {
	let release;
	const child = fakeChild();
	const server = createServerProcess({
		start: () => new Promise((resolve) => (release = () => resolve({ child, url: "u" }))),
		onCrash: () => {},
	});
	const asked = server.get("/a");
	await tick();
	const stopped = server.stop();
	release();
	await asked;
	await stopped;
	assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("nothing new is started once stopping has begun", async () => {
	const { server, started } = holder();
	await server.stop();
	await assert.rejects(server.get("/a"), /stopping/);
	assert.equal(started.length, 0);
});

test("a server that never spawned has nothing to stop, and stopping does not wait on it", async () => {
	const child = fakeChild();
	child.pid = undefined;
	const server = createServerProcess({ start: async () => ({ child, url: "u" }), onCrash: () => {} });
	await server.get("/a");
	await server.stop();
	assert.deepEqual(child.signals, []);
});
