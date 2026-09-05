/**
 * The desktop shell.
 *
 * The server owns the pi session and is the only thing that can talk to it, so
 * the app is a window pointed at it rather than a rewrite of it. It runs as a
 * child process: a crash in the agent then takes down something the shell can
 * report on, rather than the shell itself.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, Menu, app, dialog, shell } from "electron";

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

/**
 * The folder the agent works in.
 *
 * A packaged app is launched with a working directory of "/", which is not
 * somewhere anyone means to point a coding agent, so it is asked for on first
 * run and remembered next to the app's other settings.
 */
const settingsFile = () => join(app.getPath("userData"), "settings.json");

function readSettings() {
	try {
		return JSON.parse(readFileSync(settingsFile(), "utf8"));
	} catch {
		return {};
	}
}

function writeSettings(next) {
	mkdirSync(app.getPath("userData"), { recursive: true });
	writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
}

async function askForWorkdir(current) {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: "Choose a working folder",
		message: "The folder pi will read and write files in.",
		buttonLabel: "Use this folder",
		defaultPath: current ?? app.getPath("home"),
		properties: ["openDirectory", "createDirectory"],
	});
	return canceled ? null : filePaths[0];
}

async function resolveWorkdir() {
	const settings = readSettings();
	if (settings.workdir && existsSync(settings.workdir)) return settings.workdir;
	const picked = await askForWorkdir(settings.workdir);
	if (picked) writeSettings({ ...settings, workdir: picked });
	return picked;
}

let child = null;
let exiting = false;
/**
 * The server's last words. It exits deliberately for reasons a person can act
 * on — no credentials yet, a working directory that has been deleted — and
 * those reasons are worth more than the exit code the shell would otherwise
 * have to report.
 */
let serverErrors = [];

function startServer(port, workdir) {
	// ELECTRON_RUN_AS_NODE turns this same binary into plain node, so the app does
	// not depend on whatever node the machine happens to have. The server is
	// pre-bundled rather than compiled at startup: `npm run build` writes it.
	child = spawn(process.execPath, [here("../dist-server/server.mjs")], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			PORT: String(port),
			HOST,
			CLIENT_DIR: here("../dist"),
			WORKDIR: workdir,
		},
		cwd: workdir,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
	child.stderr.on("data", (d) => {
		process.stderr.write(`[server] ${d}`);
		serverErrors = [...serverErrors, ...String(d).split("\n").filter(Boolean)].slice(-10);
	});
	// A failed spawn emits 'error', not 'exit', and without this the shell would
	// sit forever waiting for a server that was never going to start.
	child.on("error", (err) => {
		serverErrors = [...serverErrors, `Could not start the pi server: ${err.message}`].slice(-10);
	});
	child.on("exit", (code) => {
		child = null;
		if (exiting) return;
		dialog.showErrorBox(
			"The pi server stopped",
			serverErrors.length ? serverErrors.join("\n") : `Exit code ${code}. Check the terminal output.`,
		);
		app.quit();
	});
}

function stopServer() {
	exiting = true;
	child?.kill();
	child = null;
}

/**
 * Changing the folder restarts the app rather than the server. Swapping it
 * underneath a live session would mean tearing down the socket, the window and
 * the session together, which is what a relaunch already does correctly.
 */
async function changeWorkdir() {
	const settings = readSettings();
	const picked = await askForWorkdir(settings.workdir);
	if (!picked || picked === settings.workdir) return;
	writeSettings({ ...settings, workdir: picked });
	app.relaunch();
	app.quit();
}

function buildMenu(workdir) {
	// A custom menu replaces the default one entirely, so the standard roles have
	// to be listed or the window loses copy, paste and the developer tools.
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{ role: "appMenu" },
			{
				label: "Folder",
				submenu: [
					{ label: "Change working folder…", accelerator: "CmdOrCtrl+O", click: changeWorkdir },
					{ label: "Reveal in Finder", click: () => shell.openPath(workdir) },
				],
			},
			{ role: "editMenu" },
			{ role: "viewMenu" },
			{ role: "windowMenu" },
		]),
	);
}

/**
 * DEV_URL points the window at a vite dev server that is already running
 * (`npm run dev`), so edits show up live — the renderer through HMR, the
 * server through tsx's watch and the client's own reconnect. No server is
 * spawned and no folder is asked for: the dev server owns both.
 */
const devUrl = process.env.DEV_URL;

async function main() {
	let url;
	let workdirForTitle = process.cwd();
	if (devUrl) {
		buildMenu(process.cwd());
		url = devUrl;
	} else {
		const workdir = await resolveWorkdir();
		if (!workdir) {
			app.quit();
			return;
		}
		workdirForTitle = workdir;
		buildMenu(workdir);
		const port = await freePort();
		startServer(port, workdir);
		url = `http://${HOST}:${port}/`;
	}
	const window = new BrowserWindow({
		width: 1200,
		height: 820,
		show: false,
		// The agent acts on this folder, so it should never be a guess.
		title: devUrl ? "pi — dev" : `pi — ${basename(workdirForTitle)}`,
		// Nothing here needs node in the renderer: it talks to the server over a
		// websocket like the browser does.
		webPreferences: { nodeIntegration: false, contextIsolation: true },
	});

	const cancel = new AbortController();
	window.on("closed", () => cancel.abort());
	if (!(await waitForServer(url, cancel.signal))) {
		if (!cancel.signal.aborted) {
			dialog.showErrorBox("The pi server did not answer", `${url} did not come up within 30 seconds.`);
			app.quit();
		}
		return;
	}
	// The page sets its own title, which would replace the folder name.
	window.on("page-title-updated", (e) => e.preventDefault());
	await window.loadURL(url);
	window.show();
}

app.whenReady().then(main);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopServer);
app.on("will-quit", stopServer);
