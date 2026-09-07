/**
 * Drive the real app in a real browser, and check what a person would look at.
 *
 * Everything else in this repo tests a function or a protocol: the reducer
 * against recordings, the tree reading against sessions pi wrote, the socket
 * against a running server. None of it would notice a component that renders
 * nothing, a control that is never reachable, or a click that goes nowhere.
 *
 * No browser library is installed and none is wanted for this: it drives the
 * Chrome already on the machine over the DevTools protocol, which is a
 * WebSocket and some JSON. `npx playwright install` would download a second
 * browser to do the same thing.
 *
 * Everything it touches is its own: its own working folder, its own session,
 * its own ports, its own browser profile, all removed at the end. It will not
 * disturb a server or a session you have open.
 *
 *   node scripts/e2e.mjs
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("..", import.meta.url));

const CHROMES = [
	process.env.CHROME,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
];

/** A port nobody is on. Asking the OS beats guessing and racing. */
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

/** Poll until it is true, rather than sleeping for as long as it might take. */
async function until(what, check, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	for (;;) {
		try {
			const value = await check();
			if (value) return value;
		} catch {
			// Not up yet, which is the usual reason.
		}
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 200));
	}
}

/**
 * A session that was asked the same thing three ways.
 *
 * Written with pi's own SessionManager rather than by hand: a branch is the
 * shape of a file, and a file this test wrote to its own idea of the shape
 * would prove only that it agrees with itself.
 */
function branchedSession(cwd) {
	const manager = SessionManager.create(cwd);
	const said = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
	const replied = (text) => ({
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		timestamp: Date.now(),
		usage: { totalTokens: 10, cost: { total: 0.001 } },
	});

	manager.appendMessage(said("what is this project"));
	manager.appendMessage(replied("a web UI over pi"));
	const asked = manager.appendMessage(said("rewrite the reducer"));
	manager.appendMessage(replied("ANSWER-ALPHA"));

	const parent = manager.getEntry(asked).parentId;
	for (const [question, answer] of [
		["rewrite the reducer, shorter", "ANSWER-BETA"],
		["rewrite the reducer, with tests", "ANSWER-GAMMA"],
	]) {
		// The first message of a session has no parent to go back to.
		if (parent === null) manager.resetLeaf();
		else manager.branch(parent);
		manager.appendMessage(said(question));
		manager.appendMessage(replied(answer));
	}
	return manager.getSessionFile();
}

/** One page, driven over the DevTools protocol. */
async function openPage(devtoolsPort, url) {
	const target = await until("a browser tab", async () => {
		const response = await fetch(`http://localhost:${devtoolsPort}/json/new?${url}`, { method: "PUT" });
		return response.ok ? await response.json() : null;
	});

	const socket = new WebSocket(target.webSocketDebuggerUrl);
	const pending = new Map();
	const errors = [];
	let id = 0;

	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
			return;
		}
		if (message.method === "Runtime.exceptionThrown") {
			errors.push(message.params.exceptionDetails.exception?.description ?? "exception");
		}
		if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
			errors.push(message.params.args.map((a) => a.value ?? a.description).join(" "));
		}
	});
	await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

	const call = (method, params = {}) =>
		new Promise((resolve) => {
			const n = ++id;
			pending.set(n, resolve);
			socket.send(JSON.stringify({ id: n, method, params }));
		});

	const evaluate = async (expression) => {
		const answer = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		const thrown = answer.result?.exceptionDetails;
		if (thrown) throw new Error(thrown.exception?.description ?? JSON.stringify(thrown));
		return answer.result?.result?.value;
	};

	await call("Runtime.enable");
	return { evaluate, errors, close: () => socket.close() };
}

/** Ask a child to stop, insist if it will not, and wait either way. */
function stop(child) {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		const insist = setTimeout(() => child.kill("SIGKILL"), 3000);
		child.once("exit", () => {
			clearTimeout(insist);
			resolve();
		});
		child.kill("SIGTERM");
	});
}

const checks = [];
const check = (name, run) => checks.push({ name, run });

/** The conversation as text, which is what the arrows are read against. */
const chat = (page) => page.evaluate("document.getElementById('chat')?.innerText ?? ''");
const marks = async (page) => ((await chat(page)).match(/ANSWER-\w+|\d\/\d/g) ?? []).join(" ");
const press = (page, title) =>
	page.evaluate(
		`(() => { const b = [...document.querySelectorAll('#chat button[title=${JSON.stringify(title)}]')].find((x) => !x.disabled); if (!b) return false; b.click(); return true; })()`,
	);
const allDisabled = (page, title) =>
	page.evaluate(
		`[...document.querySelectorAll('#chat button[title=${JSON.stringify(title)}]')].every((b) => b.disabled)`,
	);

check("the app renders a conversation", async ({ app }) => {
	await until("the conversation", () => app.evaluate("!!document.getElementById('chat')"));
});

check("a branched session opens on its newest branch", async ({ app }) => {
	await until("the resumed session", async () => (await marks(app)).includes("ANSWER-GAMMA"));
	assert.equal(await marks(app), "ANSWER-GAMMA 3/3");
});

check("the newest branch offers no next", async ({ app }) => {
	assert.equal(await allDisabled(app, "Next answer"), true);
});

check("going back shows the answer that was there before", async ({ app }) => {
	assert.equal(await press(app, "Previous answer"), true);
	await until("the previous branch", async () => (await marks(app)).includes("ANSWER-BETA"));
	assert.equal(await marks(app), "ANSWER-BETA 2/3");
});

check("the first branch offers no previous", async ({ app }) => {
	assert.equal(await press(app, "Previous answer"), true);
	await until("the first branch", async () => (await marks(app)).includes("ANSWER-ALPHA"));
	assert.equal(await marks(app), "ANSWER-ALPHA 1/3");
	assert.equal(await allDisabled(app, "Previous answer"), true);
});

check("and forward again", async ({ app }) => {
	assert.equal(await press(app, "Next answer"), true);
	await until("the second branch", async () => (await marks(app)).includes("ANSWER-BETA"));
});

check("the bench renders every scenario it knows", async ({ bench }) => {
	const scenarios = await until("the gallery", () =>
		bench.evaluate("[...document.querySelectorAll('select option')].map((o) => o.value).join(',')"),
	);
	for (const id of ["tool-headers", "branches", "thinking", "recorded:turn-with-tools"]) {
		assert.ok(scenarios.includes(id), `the bench is missing ${id}`);
	}
});

check("nothing was written to the console", async ({ app, bench }) => {
	assert.deepEqual([...app.errors, ...bench.errors], []);
});

async function main() {
	const chrome = CHROMES.find((path) => path && existsSync(path));
	if (!chrome) {
		console.error("no Chrome found. Set CHROME to one, or install Google Chrome.");
		process.exit(1);
	}

	const cwd = mkdtempSync(join(tmpdir(), "pi-e2e-"));
	const profile = mkdtempSync(join(tmpdir(), "pi-e2e-chrome-"));
	const sessionFile = branchedSession(cwd);
	const [api, web, devtools] = await Promise.all([freePort(), freePort(), freePort()]);
	const children = [];
	const logs = new Map();

	const start = (name, command, args, env) => {
		const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env } });
		children.push(child);
		logs.set(name, []);
		for (const stream of [child.stdout, child.stderr]) {
			stream.on("data", (chunk) => logs.get(name).push(chunk.toString()));
		}
		return child;
	};

	const dump = () => {
		for (const [name, lines] of logs) {
			const tail = lines.join("").trim().split("\n").slice(-10).join("\n  ");
			if (tail) console.log(`\n--- ${name}\n  ${tail}`);
		}
	};

	let page;
	let bench;
	try {
		// The client's dev server reads PORT to know where to proxy the socket,
		// which is the same variable the server reads to listen on.
		start("server", "npx", ["tsx", "server.ts"], { WORKDIR: cwd, PORT: String(api) });
		start("vite", "npx", ["vite", "--port", String(web), "--strictPort"], { PORT: String(api) });
		start("chrome", chrome, [
			"--headless=new",
			"--disable-gpu",
			"--no-first-run",
			"--no-default-browser-check",
			`--user-data-dir=${profile}`,
			`--remote-debugging-port=${devtools}`,
			"about:blank",
		]);

		await until("the api server", () => fetch(`http://localhost:${api}/`).then((r) => r.ok));
		await until("the dev server", () => fetch(`http://localhost:${web}/`).then((r) => r.ok));
		await until("the browser", () => fetch(`http://localhost:${devtools}/json/version`).then((r) => r.ok));

		page = await openPage(devtools, `http://localhost:${web}/`);
		bench = await openPage(devtools, `http://localhost:${web}/gallery.html`);

		// Open the branched session. The answer reaches the page's own socket,
		// because the server publishes a snapshot to everyone connected.
		await until("the conversation", () => page.evaluate("!!document.getElementById('chat')"));
		const opened = await page.evaluate(`new Promise((done) => {
			const seen = [];
			const socket = new WebSocket("ws://" + location.host + "/ws");
			socket.onmessage = (e) => { const m = JSON.parse(e.data); seen.push(m.type === "error" ? "error: " + m.message : m.type); };
			socket.onopen = () => socket.send(JSON.stringify({ type: "resume_session", path: ${JSON.stringify(sessionFile)} }));
			setTimeout(() => { socket.close(); done(seen.join(",")); }, 2500);
		})`);
		if (process.env.E2E_DEBUG) {
			console.log("resume →", opened);
			console.log("chat  →", JSON.stringify((await chat(page)).slice(0, 200)));
			await new Promise((r) => setTimeout(r, 4000));
			console.log("4초 뒤 chat →", JSON.stringify((await chat(page)).slice(0, 200)));
			console.log("chat 자식 수 →", await page.evaluate("document.querySelectorAll('#chat > *').length"));
			console.log("세션 이름 →", await page.evaluate("[...document.querySelectorAll('select')].map(s=>s.value).join(' | ')"));
		}

		let failed = 0;
		for (const { name, run } of checks) {
			try {
				await run({ app: page, bench });
				console.log(`  ok  ${name}`);
			} catch (error) {
				failed++;
				console.log(`  FAIL ${name}`);
				console.log(`       ${(error.message ?? error).toString().split("\n").join("\n       ")}`);
			}
		}

		console.log(`\n${checks.length - failed}/${checks.length} passed`);
		if (failed) {
			dump();
			process.exitCode = 1;
		}
	} catch (error) {
		console.error(`\n${error.message ?? error}`);
		dump();
		process.exitCode = 1;
	} finally {
		page?.close();
		bench?.close();
		// Waited for, not just asked: a browser still writing to its profile
		// makes removing that profile fail, and a cleanup that throws replaces
		// whatever went wrong with something that did not.
		await Promise.all(children.map(stop));
		// The session pi wrote lives beside the working folder, not inside it.
		const sessionDir = sessionFile ? join(sessionFile, "..") : null;
		for (const path of [cwd, profile, sessionDir]) {
			if (!path) continue;
			try {
				rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
			} catch (error) {
				console.error(`could not remove ${path}: ${error.message}`);
			}
		}
	}
}

await main();
