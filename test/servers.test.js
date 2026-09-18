import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createServers } from "../electron/servers.js";

/** A child process as far as the servers look at one: it exits when killed, unless told to hang on SIGTERM. */
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

function pool(options = {}) {
	const started = [];
	const crashes = [];
	const servers = createServers({
		start: async (workdir) => {
			const child = fakeChild(options.child?.(workdir));
			started.push({ workdir, child });
			return { child, url: `http://127.0.0.1/${started.length}` };
		},
		onCrash: (workdir, code) => crashes.push({ workdir, code }),
		graceMs: 20,
		...options.overrides,
	});
	return { servers, started, crashes };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("one server per folder, however many ask for it at once", async () => {
	const { servers, started } = pool();
	const [a1, a2, b] = await Promise.all([servers.get("/a"), servers.get("/a"), servers.get("/b")]);
	assert.equal(a1, a2);
	assert.notEqual(a1, b);
	assert.deepEqual(
		started.map((s) => s.workdir),
		["/a", "/b"],
	);
	assert.equal(servers.size, 2);
});

test("a server that exits on its own is a crash, and the next ask starts a new one", async () => {
	const { servers, started, crashes } = pool();
	const first = await servers.get("/a");
	started[0].child.exit(1);
	await tick();
	assert.deepEqual(crashes, [{ workdir: "/a", code: 1 }]);
	assert.equal(servers.size, 0);
	const second = await servers.get("/a");
	assert.notEqual(first, second);
	assert.equal(started.length, 2);
});

test("a server that fails to start is not kept, so the next ask tries again", async () => {
	let fail = true;
	const servers = createServers({
		start: async () => {
			if (fail) throw new Error("no port");
			return { child: fakeChild(), url: "http://127.0.0.1/" };
		},
		onCrash: () => {},
	});
	await assert.rejects(servers.get("/a"), /no port/);
	assert.equal(servers.size, 0);
	fail = false;
	assert.equal((await servers.get("/a")).url, "http://127.0.0.1/");
});

test("stopping asks every server to stop and waits for it, and is not a crash", async () => {
	const { servers, started, crashes } = pool();
	await Promise.all([servers.get("/a"), servers.get("/b")]);
	await servers.stopAll();
	for (const { child } of started) assert.deepEqual(child.signals, ["SIGTERM"]);
	assert.deepEqual(crashes, []);
	assert.equal(servers.size, 0);
});

test("a server that will not stop is killed outright", async () => {
	const { servers, started } = pool({ child: () => ({ hangs: true }) });
	await servers.get("/a");
	await servers.stopAll();
	assert.deepEqual(started[0].child.signals, ["SIGTERM", "SIGKILL"]);
});

test("stopping waits for a server still starting, and stops it too", async () => {
	let release;
	const child = fakeChild();
	const servers = createServers({
		start: () => new Promise((resolve) => (release = () => resolve({ child, url: "u" }))),
		onCrash: () => {},
	});
	const asked = servers.get("/a");
	await tick();
	const stopped = servers.stopAll();
	release();
	await asked;
	await stopped;
	assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("nothing new is started once stopping has begun", async () => {
	const { servers, started } = pool();
	await servers.stopAll();
	await assert.rejects(servers.get("/a"), /stopping/);
	assert.equal(started.length, 0);
});

test("a server that never spawned has nothing to stop, and stopping does not wait on it", async () => {
	const child = fakeChild();
	child.pid = undefined;
	const servers = createServers({ start: async () => ({ child, url: "u" }), onCrash: () => {} });
	await servers.get("/a");
	await servers.stopAll();
	assert.deepEqual(child.signals, []);
});
