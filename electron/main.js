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
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, shell } from "electron";
import updater from "electron-updater";

import { SCHEME, fileFor, pageUrl } from "./appScheme.js";
import { reportUrl } from "./report.js";
import { createServers, idle } from "./servers.js";
import { shellEnv } from "./shellEnv.js";
import { branchOf, git, makeWorkspace, repositoryOf } from "./git.js";
import { clone, login, repositories, repositoryName } from "./github.js";
import { firstWorkspace, projectsOf, withWorkspace } from "./workspaces.js";

// electron-updater is CommonJS and hands autoUpdater out through a getter,
// which a named import cannot see.
const { autoUpdater } = updater;

const HOST = "127.0.0.1";
const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Ask the OS for a port nobody is using, then hand it to the server — the
 * one asked for if it is free, else any.
 */
function freePort(preferred = 0) {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on("error", (err) => (preferred ? freePort().then(resolve, reject) : reject(err)));
		probe.listen(preferred, HOST, () => {
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

async function askForRepository() {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: "Open a repository",
		message: "A folder with a git repository in it. Its workspaces are made from it.",
		buttonLabel: "Open",
		defaultPath: app.getPath("home"),
		properties: ["openDirectory"],
	});
	return canceled ? null : filePaths[0];
}

/**
 * A folder's server, started on a port of its own. Its `errors` are its last
 * words: it exits deliberately for reasons a person can act on — a working
 * directory that has been deleted — and those reasons are worth more than the
 * exit code the shell would otherwise have to report.
 */
async function startServer(workdir) {
	// The port a folder had before, if it is free: a page keeps its tabs by its
	// address, so a server started again after going idle is found where it was.
	const port = await freePort(ports.get(workdir));
	ports.set(workdir, port);
	busy.set(workdir, false);
	const errors = [];
	const said = (lines) => errors.splice(0, Math.max(0, errors.push(...lines) - 10));
	// ELECTRON_RUN_AS_NODE turns this same binary into plain node, so the app does
	// not depend on whatever node the machine happens to have. The server is
	// pre-bundled rather than compiled at startup: `npm run build` writes it.
	// The search tools the agent runs — ripgrep and fd — travel with the app
	// (electron-builder.yml extraResources; scripts/tools.mjs fetches them for
	// a dev build) and go first on the server's PATH, which is where pi looks
	// for them before it thinks of downloading its own.
	const tools = app.isPackaged ? join(process.resourcesPath, "bin") : here("../build/bin");
	const child = spawn(process.execPath, [here("../dist-server/server.mjs")], {
		env: {
			...process.env,
			PATH: `${tools}:${process.env.PATH ?? ""}`,
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
	openUrlAsks(child);
	child.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
	child.stderr.on("data", (d) => {
		process.stderr.write(`[server] ${d}`);
		said(String(d).split("\n").filter(Boolean));
	});
	// A failed spawn emits 'error', not 'exit', and without this the shell would
	// sit forever waiting for a server that was never going to start.
	child.on("error", (err) => said([`Could not start the pi server: ${err.message}`]));
	// Whether it is in the middle of a run, so it is not stopped for being idle.
	child.on("message", (message) => {
		if (typeof message?.busy !== "boolean") return;
		busy.set(workdir, message.busy);
		if (!message.busy) since.set(workdir, Date.now());
	});
	return { child, url: `http://${HOST}:${port}/`, errors };
}

/** Each folder's port for as long as the app runs. */
const ports = new Map();
/** Whether each folder's server is in the middle of a run. */
const busy = new Map();
/** When each folder was last in front or last finished a run. */
const since = new Map();

/**
 * A server nobody is using is stopped after this long, and started again when
 * its workspace is next opened — a few seconds, against a process's memory
 * for as long as the app is open. Conductor keeps agent processes only for
 * the workspaces in use the same way.
 */
const IDLE_MS = 10 * 60_000;

function stopIdle() {
	for (const workdir of idle(servers.folders(), { keep: [front, wanted].filter(Boolean), busy, since, now: Date.now(), idleMs: IDLE_MS })) {
		void servers.stop(workdir);
	}
}

/**
 * Every folder's server — see servers.js. One that stops unasked says why;
 * the one in front takes the app with it, since the window has nothing left
 * to show, and one behind is started again when its folder is next opened.
 */
const servers = createServers({
	start: startServer,
	onCrash: (workdir, code, server) => {
		const why = server.errors.length ? server.errors.join("\n") : `Exit code ${code}. Check the terminal output.`;
		if (workdir !== front) {
			dialog.showErrorBox(`The server for ${basename(workdir)} stopped`, why);
			return;
		}
		dialog.showErrorBox("The server stopped", why);
		app.quit();
	},
});

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

/**
 * The other thing the server cannot do for itself: put a page in front of the
 * person. A sign-in (login.ts) hands the server a URL to open, and a page from
 * a child process is this process's to open — in the browser the person
 * already has, not in a window of ours. http(s) only: what pi hands over is a
 * web address, and anything else is not something to run.
 */
function openUrlAsks(server) {
	server.on("message", (message) => {
		if (message?.ask !== "open" || typeof message.url !== "string") return;
		if (!/^https?:\/\//.test(message.url)) {
			console.error(`[open] refused, not a web address: ${message.url}`);
			return;
		}
		void shell.openExternal(message.url);
	});
}

let quitting = false;

/**
 * Quitting waits for the servers to stop themselves.
 *
 * The shell used to be gone before a server had cleaned up, so the clean path
 * was the one only a terminal ever took. The first quit is held back until
 * every server has gone — asked, then made to, see servers.js — and the one
 * asked for afterwards finds none and goes through.
 */
async function stopServers(event) {
	if (quitting || servers.size === 0) return;
	quitting = true;
	event?.preventDefault();
	await servers.stopAll();
	app.quit();
}

/**
 * The next version, fetched from the GitHub release the app was published to
 * (publish in electron-builder.yml, which becomes app-update.yml beside the
 * app). Looked for once the window is up and every few hours after, and
 * downloaded quietly; only when it is ready is anything shown — the notes
 * from CHANGELOG.md, and a choice. Restarting stops the servers first,
 * since the installer's own quit would be held back by before-quit.
 *
 * Only in a packaged app: a dev run has no version to compare and nothing to
 * replace itself with.
 */
/**
 * Where the updater is, told to every window as it changes — see preload.cjs
 * `update`. One object, in this process, since the updater is one thing
 * however many windows there are; the page draws it and asks for the two
 * things it cannot do itself, a check and a restart.
 *
 * `justUpdated` is set once, on starting as a version other than the one
 * that last ran, and is what the page shows what is new on. Nothing here
 * decides when that has been seen: the page says (update:seen), and the
 * version it saw is kept beside the last version run.
 */
// The guides are files in the repository, read on GitHub: one copy, current with the latest release.
const DOCS = "https://github.com/minkyojung/pi-web-ui/blob/main";

let update = { current: app.getVersion(), phase: "idle", version: null, progress: null, error: null, justUpdated: null, welcomed: true };

function sayUpdate(patch) {
	update = { ...update, ...patch };
	for (const window of BrowserWindow.getAllWindows()) window.webContents.send("update:state", update);
}

function noteVersionRun() {
	const settings = readSettings();
	const before = settings.lastRunVersion ?? null;
	const now = app.getVersion();
	if (before !== now) writeSettings({ ...settings, lastRunVersion: now });
	// The first run ever has nothing to be new against; a run of the same
	// version already seen has nothing new.
	if (before && before !== now && settings.whatsNewSeen !== now) update.justUpdated = { from: before, to: now };
}

function serveUpdates() {
	ipcMain.handle("update:state", () => update);
	ipcMain.handle("update:check", () => (app.isPackaged ? autoUpdater.checkForUpdates().catch(() => {}) : null));
	ipcMain.handle("update:restart", async () => {
		quitting = true;
		await servers.stopAll();
		autoUpdater.quitAndInstall();
	});
	// The first run's page: shown until the person says Done, then not again.
	update.welcomed = readSettings().welcomed === true;
	ipcMain.handle("welcome:done", () => {
		writeSettings({ ...readSettings(), welcomed: true });
		sayUpdate({ welcomed: true });
	});
	ipcMain.handle("update:seen", () => {
		writeSettings({ ...readSettings(), whatsNewSeen: app.getVersion() });
		sayUpdate({ justUpdated: null });
	});
}

function watchForUpdates() {
	if (!app.isPackaged) return;
	autoUpdater.autoDownload = true;
	// A person who dismissed the offer and then quit gets the new version on
	// the way out, without being asked again — the updater's default, said.
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("checking-for-update", () => sayUpdate({ phase: "checking", error: null }));
	autoUpdater.on("update-available", (info) => sayUpdate({ phase: "downloading", version: info.version, progress: 0 }));
	autoUpdater.on("download-progress", (p) => sayUpdate({ progress: Math.round(p.percent) }));
	autoUpdater.on("update-not-available", () => sayUpdate({ phase: "idle", version: null, progress: null }));
	autoUpdater.on("error", (err) => {
		console.error(`[updater] ${err.message}`);
		// Back to nothing, with what went wrong on it for a page that asked; a
		// check that runs on its own says nothing and tries again next time.
		sayUpdate({ phase: "idle", progress: null, error: err.message });
	});
	// The offer is the page's (UpdateToast.tsx), drawn from this state: a
	// toast in the corner rather than a dialog over the work, and one that
	// waits for the agent to finish when asked to.
	autoUpdater.on("update-downloaded", (info) => sayUpdate({ phase: "ready", version: info.version, progress: 100 }));
	const check = () => autoUpdater.checkForUpdates().catch(() => {});
	check();
	setInterval(check, 4 * 60 * 60 * 1000).unref();
}

/**
 * The same check, asked for from the menu. The answer — the latest already,
 * a download under way, a version ready, could not check — is the page's to
 * say, in Settings › About, which is opened for it.
 */
function checkForUpdatesNow() {
	for (const window of BrowserWindow.getAllWindows()) window.webContents.send("open-settings", "About");
	if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
}

/** The window, and the folder whose page it shows. */
let window = null;
let front = null;
/** Called off when the window goes, so nothing waits on a server for a page nobody will see. */
const closing = new AbortController();
/** How many switches have been asked for: a switch that is no longer the latest gives way. */
let asked = 0;
/** The workspace a switch is on its way to, kept running while it gets there. */
let wanted = null;

/**
 * Put a folder in front: its server, started if it is not running, and the
 * window pointed at it.
 *
 * The page is loaded again rather than kept — one page, pointed at whichever
 * server is in front — while the servers behind it keep running, a turn and
 * all. What a page keeps in the browser (its tabs, where it was) is kept by
 * its server's address, which holds for as long as the app runs, so going
 * back finds them. Keeping every folder's page alive side by side would make
 * the switch instant, at the price of the menu's reload, developer tools and
 * zoom — which act on the window's own page — and of the drag region the page
 * draws; this can become that when the reload is felt.
 */
async function show(workdir) {
	if (workdir === front) return;
	const mine = ++asked;
	wanted = workdir;
	let url;
	try {
		({ url } = await servers.get(workdir));
	} catch (err) {
		if (mine === asked) wanted = null;
		if (quitting) return;
		dialog.showErrorBox("The server did not start", err.message);
		if (!front) app.quit();
		return;
	}
	if (!(await waitForServer(url, closing.signal))) {
		if (mine === asked) wanted = null;
		if (!closing.signal.aborted) dialog.showErrorBox("The server did not answer", `${url} did not come up within 30 seconds.`);
		if (!front) app.quit();
		return;
	}
	if (mine !== asked) return;
	if (front) since.set(front, Date.now());
	front = workdir;
	wanted = null;
	// The workspace to open on the next start — see firstWorkspace.
	writeSettings({ ...readSettings(), workdir });
	// The agent acts on this folder, so it should never be a guess.
	window.setTitle(`Octave — ${basename(workdir)}`);
	// A load cut short by the next switch is that switch's to finish.
	await window.loadURL(url).catch((err) => console.error(`[window] ${err.message}`));
}

/**
 * Where clones and workspaces are kept: a folder the person can see and open
 * in the Finder, a terminal or an editor, as Conductor keeps ~/conductor.
 * Workspaces go under `workspaces/{repository}/{city}`.
 */
const home = () => join(homedir(), "octave");

/**
 * Whether a folder is still a checkout to list: a clone and a worktree both
 * have a `.git`, and a folder that has lost it — or a folder of notes from
 * before there were repositories — is not one.
 */
const isCheckout = (path) => existsSync(join(path, ".git"));

/** Tell the page the list has changed, so it asks again. */
function workspacesChanged() {
	if (window && !window.isDestroyed()) window.webContents.send("workspaces:changed");
}

/**
 * The list for the sidebar: every repository and its workspaces, each named
 * by the branch it is on now — read from git each time, since the branch is
 * what gets renamed once the work has a subject, by the agent or by hand.
 */
async function workspaces() {
	const projects = projectsOf(readSettings(), isCheckout);
	return {
		current: front,
		projects: await Promise.all(
			projects.map(async (project) => ({
				path: project.path,
				name: basename(project.path),
				worktrees: await Promise.all(
					project.worktrees.map(async (worktree) => ({ path: worktree.path, name: worktree.name, branch: (await branchOf(worktree.path)) ?? worktree.branch })),
				),
			})),
		),
	};
}

/** One workspace made at a time, so two asked for at once cannot both pick the same city. */
let making = Promise.resolve();

/** A new workspace of a repository in the list, and the window put on it. */
function newWorkspace(root) {
	const made = making.then(async () => {
		if (!projectsOf(readSettings(), isCheckout).some((project) => project.path === root)) return null;
		try {
			const worktree = await makeWorkspace(root, { into: join(home(), "workspaces", basename(root)), owner: await login() });
			writeSettings({ ...readSettings(), projects: withWorkspace(projectsOf(readSettings(), isCheckout), root, worktree) });
			workspacesChanged();
			return worktree;
		} catch (err) {
			dialog.showErrorBox("The workspace could not be made", err.message);
			return null;
		}
	});
	making = made.then(() => {});
	return made.then((worktree) => {
		if (worktree) void show(worktree.path);
		return worktree?.path ?? null;
	});
}

/** A workspace from the list put in front. Only one on the list: the page does not name folders of its own. */
function openWorkspace(path) {
	const known = projectsOf(readSettings(), isCheckout).some((project) => project.worktrees.some((worktree) => worktree.path === path));
	if (known) void show(path);
}

/** The screen that adds a repository, when there is no workspace to put in front. */
async function showStart() {
	++asked;
	wanted = null;
	if (front) since.set(front, Date.now());
	front = null;
	window.setTitle("Octave");
	await window.loadURL(pageUrl("start.html")).catch((err) => console.error(`[window] ${err.message}`));
}

/**
 * A repository chosen in the Finder, added to the list, and a workspace of it
 * put in front — its first, or one made now if it has none, as Conductor
 * makes one on adding a repository. A folder anywhere inside a repository
 * adds that repository. Says why not when the folder is in none; a choice
 * cancelled says nothing.
 */
async function openLocalRepository() {
	const picked = await askForRepository();
	if (!picked) return null;
	const root = await repositoryOf(picked);
	if (!root) return { error: `${basename(picked)} is not in a git repository.` };
	await addRepository(root);
	return {};
}

/** A repository's clone added to the list, and its first workspace put in front — made now if it has none. */
async function addRepository(root) {
	const projects = withWorkspace(projectsOf(readSettings(), isCheckout), root);
	writeSettings({ ...readSettings(), projects });
	workspacesChanged();
	const first = projects.find((project) => project.path === root)?.worktrees[0];
	if (first) void show(first.path);
	else await newWorkspace(root);
}

/**
 * A GitHub repository cloned into `~/octave/repos/{name}` and added, as a
 * folder chosen in the Finder is. A clone of the same repository already
 * there is used rather than cloned again; any other folder there is not
 * touched. Says why not in gh's or git's words.
 */
async function cloneRepository(source) {
	const repo = repositoryName(source);
	if (!repo) return { error: "Give a repository as owner/name, or its GitHub address." };
	const into = join(home(), "repos", repo.name);
	if (existsSync(into)) {
		const origin = (await repositoryOf(into)) === into ? await git(into, ["remote", "get-url", "origin"]).catch(() => null) : null;
		const same = repositoryName(origin);
		if (!same || same.owner.toLowerCase() !== repo.owner.toLowerCase() || same.name.toLowerCase() !== repo.name.toLowerCase()) {
			return { error: `There is already a folder at ${into}, and it is not ${repo.owner}/${repo.name}.` };
		}
	} else {
		mkdirSync(dirname(into), { recursive: true });
		try {
			await clone(repo, into);
		} catch (err) {
			return { error: err.message };
		}
	}
	await addRepository(into);
	return {};
}

/** The same, from the menu, where there is no page to say why not. */
async function openRepositoryFromMenu() {
	const result = await openLocalRepository();
	if (result?.error) dialog.showErrorBox("That folder cannot be opened", result.error);
}

/**
 * What the page asks of the shell: the repositories and their workspaces,
 * and a file shown in the Finder. In a dev run the dev server owns the
 * folder, so there is no list to switch in and nothing to add to it.
 */
function serveFolders() {
	ipcMain.handle("repository:open", () => (devUrl ? null : openLocalRepository()));
	ipcMain.handle("repository:clone", (_event, source) => (devUrl ? null : cloneRepository(source)));
	// What the clone dialog offers, or null when gh cannot say.
	ipcMain.handle("github:repositories", () => (devUrl ? null : repositories()));
	// The list, and the two things done to it. In a dev run the dev server owns
	// the folder, so there is no list to switch in.
	ipcMain.handle("workspaces", () => (devUrl ? null : workspaces()));
	ipcMain.handle("workspace:new", (_event, root) => (devUrl ? null : newWorkspace(root)));
	ipcMain.handle("workspace:open", (_event, path) => (devUrl ? null : openWorkspace(path)));
	// A note in the Finder. The page is told the folder in full by the server
	// (ConfigMsg.folder) and joins the note's path onto it, which is a better
	// source than this process has: in a dev run the settings hold no workdir
	// at all. showItemInFolder on a path that is not there does nothing, which
	// is the right amount of fuss for a file that was just deleted.
	ipcMain.handle("file:reveal", (_event, path) => shell.showItemInFolder(path));
}

/** Where the server writes its log — log.ts says the same, from the same two places. */
const logPath = () => join(process.env.APP_DIR ?? join(app.getPath("home"), ".octave"), "logs", "server.log");

/** The log chosen in the Finder, or its folder — made if need be — when there is no log yet. */
function showLog() {
	const log = logPath();
	if (existsSync(log)) return shell.showItemInFolder(log);
	mkdirSync(join(log, ".."), { recursive: true });
	shell.openPath(join(log, ".."));
}

function reportProblem() {
	showLog();
	shell.openExternal(reportUrl({ version: app.getVersion(), macos: process.getSystemVersion(), arch: process.arch }));
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
					{ label: "Open Repository…", accelerator: "CmdOrCtrl+O", click: openRepositoryFromMenu },
					// Nothing is in front on the start screen, and nothing is revealed.
					{ label: "Reveal in Finder", click: () => (front ?? workdir) && shell.openPath(front ?? workdir) },
				],
			},
			{ role: "editMenu" },
			{ role: "viewMenu" },
			// The standard window menu less Close: ⌘W is the page's, for the tab in
			// front, and a menu accelerator would take it before the page heard it.
			{ role: "window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] },
			// Two things at once, since a report wants both: the folder the log is
			// in, to drag from, and the form to drag it into. The app sends nothing
			// itself — see report.js.
			{
				role: "help",
				submenu: [
					{ label: "Welcome", click: () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send("open-page", "welcome"); } },
					{ label: "What's New", click: () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send("open-page", "whats-new"); } },
					{ label: "Getting Started", click: () => void shell.openExternal(`${DOCS}/GETTING_STARTED.md`) },
					{ label: "What Leaves Your Mac", click: () => void shell.openExternal(`${DOCS}/PRIVACY.md`) },
					{ type: "separator" },
					{ label: "Report a Problem…", click: reportProblem },
					{ label: "Show Log in Finder", click: showLog },
				],
			},
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
	serveUpdates();
	noteVersionRun();
	// Before anything is started, so the servers and every command they run
	// find what a terminal would — see shellEnv.js. A dev run was started from
	// a terminal and has it already.
	if (app.isPackaged) {
		const env = await shellEnv({ shell: process.env.SHELL || "/bin/zsh", node: process.execPath });
		if (env) Object.assign(process.env, env);
		else console.error("[shell] the login shell's environment could not be read; going on with the app's own");
	}
	// The app's own pages — see appScheme.js.
	protocol.handle(SCHEME, (request) => {
		const file = fileFor(here("../dist"), request.url);
		return file ? net.fetch(pathToFileURL(file).toString()) : new Response("Not found", { status: 404 });
	});
	const settings = readSettings();
	const first = devUrl ? null : firstWorkspace(projectsOf(settings, isCheckout), settings.workdir);
	buildMenu(devUrl ? process.cwd() : null);
	window = new BrowserWindow({
		width: 1200,
		height: 820,
		show: false,
		title: "Octave — dev",
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
	// The page asks for the state as it loads (update.state); this covers a
	// change while it was loading.
	window.webContents.on("did-finish-load", () => window.webContents.send("update:state", update));
	window.on("enter-full-screen", () => markTrafficLights(window));
	window.on("leave-full-screen", () => markTrafficLights(window));

	window.on("closed", () => closing.abort());
	// The page sets its own title, which would replace the folder name.
	window.on("page-title-updated", (e) => e.preventDefault());
	if (devUrl) {
		if (!(await waitForServer(devUrl, closing.signal))) {
			if (!closing.signal.aborted) {
				dialog.showErrorBox("The server did not answer", `${devUrl} did not come up within 30 seconds.`);
				app.quit();
			}
			return;
		}
		await window.loadURL(devUrl);
	} else if (first) {
		await show(first);
		if (!front) return; // Its server did not answer, and the app is on its way out.
	} else {
		await showStart();
	}
	window.show();
	watchForUpdates();
	setInterval(stopIdle, 60_000).unref();
}

// Before the app is ready, as Electron requires: a scheme of the app's own
// that behaves as a web page's would, so the start page's modules load.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(main);
app.on("window-all-closed", () => app.quit());
// Once, on the way out: stopServers holds this quit back, and the one it asks
// for afterwards goes through.
app.on("before-quit", stopServers);
