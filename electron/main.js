/**
 * The desktop shell.
 *
 * The server owns the pi session and is the only thing that can talk to it, so
 * the app is a window pointed at it rather than a rewrite of it. It runs as a
 * child process: a crash in the agent then takes down something the shell can
 * report on, rather than the shell itself.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { BrowserWindow, app, dialog } from "electron";

const HOST = "127.0.0.1";
const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** Ask the OS for a port nobody is using, then hand it to the server. */
function freePort() {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, HOST, () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
}

/** The server is up once it answers, which is later than "the process started". */
async function waitForServer(url, signal) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (signal.aborted) return false;
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
			if (res.ok) return true;
		} catch {
			// Not listening yet.
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	return false;
}

let child = null;
let exiting = false;

function startServer(port) {
	// ELECTRON_RUN_AS_NODE turns this same binary into plain node, so the app does
	// not depend on whatever node the machine happens to have.
	child = spawn(process.execPath, [here("../node_modules/tsx/dist/cli.mjs"), here("../server.ts")], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), HOST },
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
	child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
	child.on("exit", (code) => {
		child = null;
		if (exiting) return;
		dialog.showErrorBox("서버가 종료되었습니다", `pi 서버가 코드 ${code}로 종료됐습니다. 터미널 출력을 확인해 주세요.`);
		app.quit();
	});
}

function stopServer() {
	exiting = true;
	child?.kill();
	child = null;
}

async function main() {
	const port = await freePort();
	startServer(port);

	const url = `http://${HOST}:${port}/`;
	const window = new BrowserWindow({
		width: 1200,
		height: 820,
		show: false,
		title: "pi",
		// Nothing here needs node in the renderer: it talks to the server over a
		// websocket like the browser does.
		webPreferences: { nodeIntegration: false, contextIsolation: true },
	});

	const cancel = new AbortController();
	window.on("closed", () => cancel.abort());
	if (!(await waitForServer(url, cancel.signal))) {
		if (!cancel.signal.aborted) {
			dialog.showErrorBox("서버가 응답하지 않습니다", `${url} 이 30초 안에 열리지 않았습니다.`);
			app.quit();
		}
		return;
	}
	await window.loadURL(url);
	window.show();
}

app.whenReady().then(main);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopServer);
app.on("will-quit", stopServer);
