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
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from "electron";
import updater from "electron-updater";

// electron-updater is CommonJS and hands autoUpdater out through a getter,
// which a named import cannot see.
const { autoUpdater } = updater;

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

/**
 * The folders worked in before, newest first and the current one at its head,
 * so the page can offer them the way Obsidian offers its vaults. Ones that
 * have since been deleted or moved are dropped as they are read: a list that
 * offers a folder which is not there is worse than a short list.
 */
const RECENT = 8;
function remember(settings, workdir) {
	const recent = [workdir, ...(settings.recent ?? []).filter((path) => path !== workdir)]
		.filter((path) => existsSync(path))
		.slice(0, RECENT);
	return { ...settings, workdir, recent };
}

async function resolveWorkdir() {
	const settings = readSettings();
	const known = settings.workdir && existsSync(settings.workdir) ? settings.workdir : await askForWorkdir(settings.workdir);
	if (known) writeSettings(remember(settings, known));
	return known;
}

let child = null;
let exiting = false;
/**
 * The server's last words. It exits deliberately for reasons a person can act
 * on — a working directory that has been deleted — and
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
		// The fourth is a channel, which is what the server asks for a deleted
		// note to go to the machine's trash on — see trash.ts. Its presence is
		// how the server knows there is a shell at all, so nothing else has to
		// say which kind of run this is.
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	answerTrashAsks(child, workdir);
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

/**
 * The one thing the server cannot do for itself: put a file in the trash the
 * person already has.
 *
 * Not a folder to move a file into — a file renamed into ~/.Trash is there
 * with its way home lost, since what Put Back knows is kept by the Finder and
 * not by the file. It takes the platform's own call, and in Electron that is
 * shell.trashItem, in this process and no other.
 *
 * Inside the folder that was opened, and nowhere else. The server resolves and
 * contains every path it handles already, so this is the second lock on the
 * same door: whatever goes wrong upstream, the shell will not throw away
 * something the person did not point this app at.
 */
function answerTrashAsks(server, workdir) {
	const root = resolve(workdir) + sep;
	server.on("message", async (message) => {
		if (message?.ask !== "trash" || typeof message.id !== "number" || typeof message.path !== "string") return;
		let ok = false;
		if (resolve(message.path).startsWith(root)) {
			try {
				await shell.trashItem(message.path);
				ok = true;
			} catch (err) {
				console.error(`[trash] ${err.message}`);
			}
		} else {
			console.error(`[trash] refused, outside the folder: ${message.path}`);
		}
		// The server is waiting on this and falls back to the vault's own trash
		// without it, so an answer goes back either way.
		if (server.connected) server.send({ ask: "trash", id: message.id, ok });
	});
}

let stopping = false;

/**
 * Quitting waits for the server to stop itself.
 *
 * kill() sends SIGTERM, which the server answers by retiring its extensions,
 * cancelling the questions it has open and disposing the session — work that
 * takes a moment and that nothing else does. The shell used to be gone before
 * any of it ran, so the clean path was the one only a terminal ever took.
 *
 * The first quit is held back until the child has gone. Three seconds later
 * it is taken out with SIGKILL: a quit that hangs on a server that will not
 * stop is worse than a hard stop, and by then the cleanup has either happened
 * or is not going to.
 */
async function stopServer(event) {
	if (stopping || !child) return;
	event?.preventDefault();
	await endServer();
	app.quit();
}

/** The server told to stop, and waited for. The quit that follows is the caller's. */
async function endServer() {
	stopping = true;
	exiting = true;
	const server = child;
	const gone = new Promise((resolve) => server.once("exit", resolve));
	server.kill();
	const hard = setTimeout(() => server.kill("SIGKILL"), 3000);
	await gone;
	clearTimeout(hard);
	child = null;
}

/**
 * The next version, fetched from the GitHub release the app was published to
 * (publish in electron-builder.yml, which becomes app-update.yml beside the
 * app). Looked for once the window is up and every few hours after, and
 * downloaded quietly; only when it is ready is anything shown — the notes
 * from CHANGELOG.md, and a choice. Restarting goes through endServer first,
 * since the installer's own quit would be held back by before-quit.
 *
 * Only in a packaged app: a dev run has no version to compare and nothing to
 * replace itself with.
 */
function watchForUpdates() {
	if (!app.isPackaged) return;
	autoUpdater.autoDownload = true;
	autoUpdater.on("error", (err) => console.error(`[updater] ${err.message}`));
	autoUpdater.on("update-downloaded", async (info) => {
		const notes = typeof info.releaseNotes === "string" ? info.releaseNotes.replace(/<[^>]+>/g, "").trim() : "";
		const { response } = await dialog.showMessageBox({
			type: "info",
			title: `Octave ${info.version}`,
			message: `Octave ${info.version} is ready to install.`,
			detail: notes || undefined,
			buttons: ["Restart now", "Later"],
			defaultId: 0,
			cancelId: 1,
		});
		if (response !== 0) return;
		if (child) await endServer();
		autoUpdater.quitAndInstall();
	});
	const check = () => autoUpdater.checkForUpdates().catch(() => {});
	check();
	setInterval(check, 4 * 60 * 60 * 1000).unref();
}

/** The same check, asked for from the menu, which answers either way. */
async function checkForUpdatesNow() {
	if (!app.isPackaged) {
		dialog.showMessageBox({ type: "info", message: "A dev run does not update." });
		return;
	}
	try {
		const result = await autoUpdater.checkForUpdates();
		if (!result?.isUpdateAvailable) {
			dialog.showMessageBox({ type: "info", message: `Octave ${app.getVersion()} is the latest.` });
		}
	} catch (err) {
		dialog.showMessageBox({ type: "warning", message: "Could not check for updates.", detail: err.message });
	}
}

/**
 * Changing the folder restarts the app rather than the server. Swapping it
 * underneath a live session would mean tearing down the socket, the window and
 * the session together, which is what a relaunch already does correctly.
 */
function openWorkdir(picked) {
	const settings = readSettings();
	if (!picked || picked === settings.workdir || !existsSync(picked)) return;
	writeSettings(remember(settings, picked));
	app.relaunch();
	app.quit();
}

async function changeWorkdir() {
	openWorkdir(await askForWorkdir(readSettings().workdir));
}

/**
 * The folder, for the page's own picker. In a dev run the dev server owns the
 * folder and a relaunch would not change it, so there is nothing to offer and
 * the page says so by drawing a name rather than a menu.
 */
function serveFolders() {
	ipcMain.handle("folders", () => {
		if (devUrl) return { current: null, recent: [] };
		const settings = readSettings();
		return { current: settings.workdir ?? null, recent: (settings.recent ?? []).filter((path) => existsSync(path)) };
	});
	ipcMain.handle("folder:choose", changeWorkdir);
	ipcMain.handle("folder:open", (_event, path) => openWorkdir(path));
	// A note in the Finder. The page is told the folder in full by the server
	// (ConfigMsg.folder) and joins the note's path onto it, which is a better
	// source than this process has: in a dev run the settings hold no workdir
	// at all. showItemInFolder on a path that is not there does nothing, which
	// is the right amount of fuss for a file that was just deleted.
	ipcMain.handle("file:reveal", (_event, path) => shell.showItemInFolder(path));
}

function buildMenu(workdir) {
	// A custom menu replaces the default one entirely, so the standard roles have
	// to be listed or the window loses copy, paste and the developer tools.
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			// The standard app menu, with one line of ours in it.
			{
				role: "appMenu",
				submenu: [
					{ role: "about" },
					{ label: "Check for Updates…", click: checkForUpdatesNow },
					{ type: "separator" },
					{ role: "services" },
					{ type: "separator" },
					{ role: "hide" },
					{ role: "hideOthers" },
					{ role: "unhide" },
					{ type: "separator" },
					{ role: "quit" },
				],
			},
			{
				label: "Folder",
				submenu: [
					{ label: "Change working folder…", accelerator: "CmdOrCtrl+O", click: changeWorkdir },
					{ label: "Reveal in Finder", click: () => shell.openPath(workdir) },
				],
			},
			{ role: "editMenu" },
			{ role: "viewMenu" },
			// The standard window menu less Close: ⌘W is the page's, for the tab in
			// front, and a menu accelerator would take it before the page heard it.
			{ role: "window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] },
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

/**
 * The window has no title bar of its own, so the page draws the top row and has
 * to know two things the DOM cannot see for itself: whether it is inside the
 * shell at all — the same page served to a browser tab has no traffic lights to
 * leave room for — and whether those lights are on screen right now, because
 * full screen takes them away and the gap held open for them would be a hole.
 *
 * A class on <html> rather than IPC: there is no preload script, and adding one
 * to carry a single boolean would cost more than it explains.
 */
function markTrafficLights(window) {
	const showing = process.platform === "darwin" && !window.isFullScreen();
	window.webContents
		.executeJavaScript(`document.documentElement.classList.toggle("traffic-lights", ${showing})`)
		.catch(() => {});
}

async function main() {
	serveFolders();
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
		title: devUrl ? "Octave — dev" : `Octave — ${basename(workdirForTitle)}`,
		// The columns are the app. A title bar above them would be a fourth band
		// of chrome saying what the folder menu already says, so it is dropped and
		// the traffic lights are dropped onto the list's own header instead —
		// 'hidden' rather than 'hiddenInset' because only the former lets us say
		// where, and the lights have to line up with a row we chose the height of.
		...(process.platform === "darwin"
			? { titleBarStyle: "hidden", trafficLightPosition: { x: 20, y: 16 } }
			: {}),
		// Nothing here needs node in the renderer: it talks to the server over a
		// websocket like the browser does. The preload carries the one thing no
		// page can do — see preload.cjs.
		webPreferences: { nodeIntegration: false, contextIsolation: true, preload: here("preload.cjs") },
	});
	window.webContents.on("did-finish-load", () => markTrafficLights(window));
	window.on("enter-full-screen", () => markTrafficLights(window));
	window.on("leave-full-screen", () => markTrafficLights(window));

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
	watchForUpdates();
}

app.whenReady().then(main);
app.on("window-all-closed", () => app.quit());
// Once, on the way out: stopServer holds this quit back, and the one it asks
// for afterwards finds no child and goes through.
app.on("before-quit", stopServer);
