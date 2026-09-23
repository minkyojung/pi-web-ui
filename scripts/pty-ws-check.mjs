/**
 * The /pty channel, end to end against a real server: a shell comes up in
 * a temporary folder, its bytes arrive whole (a Korean word among them), a
 * resize reaches it, a burst it prints is held back until the screen says
 * it drew it (flow.ts), `close` ends it, and its exit is reported.
 *
 *   node scripts/pty-ws-check.mjs
 *
 * Starts `tsx server.ts` on a free port with a scratch WORKDIR and APP_DIR,
 * and stops it after. Exits 0 when every check held.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const HIGH = 256 * 1024;
const cwd = mkdtempSync(join(tmpdir(), "octave-pty-"));
const appDir = mkdtempSync(join(tmpdir(), "octave-pty-app-"));
const port = await new Promise((resolve) => {
	const s = createServer().listen(0, "127.0.0.1", () => {
		const { port } = s.address();
		s.close(() => resolve(port));
	});
});

const server = spawn("npx", ["tsx", "server.ts"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", WORKDIR: cwd, APP_DIR: appDir }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
await new Promise((resolve, reject) => {
	const t = setInterval(() => {
		if (log.includes("open http://")) (clearInterval(t), resolve());
		if (server.exitCode !== null) (clearInterval(t), reject(new Error(`server died:\n${log}`)));
	}, 50);
});

const failures = [];
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
	if (!ok) failures.push(name);
};
const until = (what, timeout = 10_000) =>
	new Promise((resolve, reject) => {
		const t0 = Date.now();
		const t = setInterval(() => {
			if (what()) (clearInterval(t), resolve());
			else if (Date.now() - t0 > timeout) (clearInterval(t), reject(new Error("timed out")));
		}, 20);
	});

function open(id) {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/pty?folder=${encodeURIComponent(cwd)}&id=${id}`);
	// A screen that draws what it is sent and says so — unless a check is
	// about what happens when it does not.
	const state = { ws, bytes: 0, text: "", control: [], closed: null, draws: true };
	ws.on("message", (data, isBinary) => {
		if (isBinary) {
			state.bytes += data.length;
			state.text += data.toString("utf8");
			if (state.draws) ws.send(JSON.stringify({ type: "ack", bytes: data.length }));
		} else state.control.push(JSON.parse(data.toString()));
	});
	ws.on("close", (code, reason) => (state.closed = { code, reason: reason.toString() }));
	return new Promise((resolve, reject) => {
		ws.once("open", () => resolve(state));
		ws.once("error", reject);
	});
}
const type = (s, text) => s.ws.send(Buffer.from(text, "utf8"), { binary: true });
const say = (s, msg) => s.ws.send(JSON.stringify(msg));

try {
	// 1. A shell, its prompt, and a Korean word through it whole.
	const a = await open("check");
	await until(() => a.text.length > 0);
	type(a, "echo 시작-한글-끝\r");
	await until(() => /시작-한글-끝\r?\n/.test(a.text.replace(/echo 시작-한글-끝/g, "")));
	check("a shell answers, and a Korean word arrives whole", true);

	// 2. A resize reaches the shell.
	say(a, { type: "resize", cols: 132, rows: 40 });
	type(a, "echo cols=$(tput cols) rows=$(tput lines)\r");
	await until(() => /cols=132 rows=40\r?\n/.test(a.text));
	check("a resize reaches the shell", true);

	// 3. A burst is held back until acknowledged: without acks, no more than
	//    HIGH and one read's worth arrives. The marks are computed by the
	//    shell so that the echo of the typed line does not stand in for them.
	const before = a.bytes;
	a.draws = false;
	type(a, "head -c 1048576 /dev/zero | tr '\\0' 'x'; echo; echo BURST-$((40+2))\r");
	await new Promise((r) => setTimeout(r, 1500));
	const held = a.bytes - before;
	check("a burst is held back with nothing drawn", held <= HIGH + 64 * 1024 && held > 0, `${held} bytes arrived`);
	check("the end of the burst has not come yet", !a.text.includes("BURST-42"), `${a.bytes - before} bytes`);
	// The screen drew it all: the rest comes.
	a.draws = true;
	say(a, { type: "ack", bytes: held });
	await until(() => a.text.includes("BURST-42"), 20_000).catch(() => {});
	check("once acknowledged, the rest of the burst comes", a.text.includes("BURST-42"), `${a.bytes - before} bytes in all; tail: ${JSON.stringify(a.text.slice(-120))}`);

	// 4. A second socket takes the terminal; the first is told.
	const b = await open("check");
	await until(() => a.closed !== null);
	check("a second screen takes the terminal, and the first is closed with a reason", a.closed?.code === 1000 && /another tab/.test(a.closed?.reason), JSON.stringify(a.closed));
	type(b, "echo still-$((20+3))\r");
	await until(() => /still-23\r?\n/.test(b.text)).catch(() => {});
	check("it is the same shell", /still-23\r?\n/.test(b.text), `b got ${b.bytes} bytes; tail: ${JSON.stringify(b.text.slice(-160))}`);

	// 4b. What was printed while nobody looked is on the screen the next
	//     socket is handed first — after the shell is resized small enough
	//     that the earlier burst has scrolled out of what is kept.
	type(b, "clear; echo kept-$((100+1))\r");
	await until(() => /kept-101\r?\n/.test(b.text));
	b.ws.close();
	await until(() => b.closed !== null);
	const e = await open("check");
	await until(() => e.bytes > 0);
	await new Promise((r) => setTimeout(r, 300));
	check("a socket that attaches later is first shown what the screen kept", /kept-101/.test(e.text) && /% /.test(e.text), JSON.stringify(e.text.slice(0, 200)));
	type(e, "echo after-$((1+1))\r");
	await until(() => /after-2\r?\n/.test(e.text)).catch(() => {});
	check("and the shell goes on from there", /after-2\r?\n/.test(e.text), JSON.stringify(e.text.slice(-120)));
	const b2 = e;

	// 5. `close` ends the shell and its exit is reported.
	say(b2, { type: "close" });
	await until(() => b2.control.some((m) => m.type === "exit"));
	check("close ends the shell and its exit is reported", true, JSON.stringify(b2.control));
	b2.ws.close();

	// 6. A shell that exits on its own reports its code.
	const c = await open("exits");
	await until(() => c.text.length > 0);
	type(c, "exit 7\r");
	await until(() => c.control.some((m) => m.type === "exit"));
	check("a shell that exits says its code", c.control.find((m) => m.type === "exit")?.code === 7, JSON.stringify(c.control));
	c.ws.close();

	// 7. A folder this server may not work in is refused.
	const d = new WebSocket(`ws://127.0.0.1:${port}/pty?folder=%2Fetc&id=1`);
	const refused = await new Promise((resolve) => {
		d.on("close", (code) => resolve(code));
		d.on("error", () => {});
	});
	check("a folder not this server's is refused", refused === 1008, String(refused));
} catch (err) {
	check("the checks ran through", false, err.stack ?? String(err));
} finally {
	server.kill("SIGTERM");
	await new Promise((r) => server.once("exit", r));
	rmSync(cwd, { recursive: true, force: true });
	rmSync(appDir, { recursive: true, force: true });
}
if (failures.length) {
	console.log(`\n${failures.length} failed\n--- server log ---\n${log.slice(-3000)}`);
	process.exit(1);
}
console.log("\nall held");
