/**
 * The desktop shell.
 *
 * The server owns the pi session and is the only thing that can talk to it, so
 * the app is a window pointed at it rather than a rewrite of it. It runs as a
 * child process: a crash in the agent then takes down something the shell can
 * report on, rather than the shell itself.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, shell } from "electron";
import updater from "electron-updater";

import { SCHEME, fileFor, pageUrl } from "./appScheme.js";
import { reportUrl } from "./report.js";
import { CONFIG_FILE, DEFAULT_TIMEOUT, isConfig, readConfig } from "./octaveConfig.js";
import { prefsOf, withPref } from "./prefs.js";
import { createRuns } from "./runs.js";
import { runScript } from "./scripts.js";
import { createServers, idle } from "./servers.js";
import { shellEnv } from "./shellEnv.js";
import { branchOf, changesIn, git, makeWorkspace, onRemote, remoteBranches, removeWorktree, repositoryOf } from "./git.js";
import { clone, issues, login, pullRequests, repositories, repositoryName } from "./github.js";
import { editorsOn, openingOf } from "./editors.js";
import { firstFrom, firsts } from "./firstSpec.js";
import { firstWorkspace, projectsOf, statusOf, withWorkspace, withoutWorkspace } from "./workspaces.js";

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
	// The port a folder had before, if it is free: nothing of the page's is
	// kept by it (web/src/workspace.ts), but a server started again after
	// going idle is found where it was.
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
/** Each folder's port for the repository's own run command — `OCTAVE_PORT`, kept the same for as long as the app runs, as the server's is. */
const runPorts = new Map();
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
	if (quitting) return;
	quitting = true;
	event?.preventDefault();
	await Promise.all([servers.stopAll(), runs.stopAll()]);
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

let update = { current: app.getVersion(), phase: "idle", version: null, progress: null, error: null, justUpdated: null, dismissed: null };

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
		await Promise.all([servers.stopAll(), runs.stopAll()]);
		autoUpdater.quitAndInstall();
	});
	ipcMain.handle("update:seen", () => {
		writeSettings({ ...readSettings(), whatsNewSeen: app.getVersion() });
		sayUpdate({ justUpdated: null });
	});
	// An offer waved away stays away for as long as the app runs, whichever
	// page is up: the page is loaded again at every workspace, and a toast
	// that came back at each would be asking again.
	ipcMain.handle("update:dismiss", (_event, version) => sayUpdate({ dismissed: typeof version === "string" ? version : null }));
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
 * all. What a page keeps in the browser about its workspace (its tabs, where
 * it was) is kept by the workspace's folder (web/src/workspace.ts), and what
 * it keeps about the window by the shell (prefs.js), so going back finds
 * them. Keeping every folder's page alive side by side would make
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
		// Nothing to fall back to only while starting: once the window is up it
		// is on a workspace or on the first screen, and stays there.
		if (!window.isVisible()) app.quit();
		return;
	}
	if (!(await waitForServer(url, closing.signal))) {
		if (mine === asked) wanted = null;
		if (!closing.signal.aborted) dialog.showErrorBox("The server did not answer", `${url} did not come up within 30 seconds.`);
		if (!window.isVisible()) app.quit();
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
	// Which of these a page is on is not said here: the page knows its own
	// folder from its server, and the one in front is where the window is
	// going, which a page still up while it goes there is not.
	return {
		projects: await Promise.all(
			projects.map(async (project) => {
				const prs = await pullRequestsOf(project.path);
				return {
					path: project.path,
					name: basename(project.path),
					worktrees: await Promise.all(
						project.worktrees.map(async (worktree) => {
							const branch = (await branchOf(worktree.path)) ?? worktree.branch;
							// Where the branch stands, for the row to say: git's word, and
							// GitHub's when gh can give it. A workspace whose branch git
							// cannot read is listed as only here.
							const remote = await onRemote(project.path, branch).catch(() => false);
							return { path: worktree.path, name: worktree.name, branch, status: statusOf({ onRemote: remote, pr: prs?.get(branch) ?? null }) };
						}),
					),
				};
			}),
		),
	};
}

/**
 * A repository's pull requests by branch, asked of gh at most once every
 * half minute: the list is drawn again at every change and every focus, and
 * a call to GitHub for each would make the sidebar wait on the network.
 */
const prsAsked = new Map();
function pullRequestsOf(root) {
	const had = prsAsked.get(root);
	if (had && Date.now() - had.at < 30_000) return had.answer;
	const answer = pullRequests(root).catch(() => null);
	prsAsked.set(root, { at: Date.now(), answer });
	return answer;
}

/**
 * What the first screen's dialog offers: pi's answer, from dist-server/models.mjs
 * run the way the server is, held for half a minute — sign-ins change it,
 * and a dialog opened twice in a minute need not ask twice.
 */
let modelsAsked = null;
function modelsForHome() {
	if (modelsAsked && Date.now() - modelsAsked.at < 30_000) return modelsAsked.answer;
	const tools = app.isPackaged ? join(process.resourcesPath, "bin") : here("../build/bin");
	const answer = new Promise((resolve) => {
		execFile(process.execPath, [here("../dist-server/models.mjs")], { env: { ...process.env, PATH: `${tools}:${process.env.PATH ?? ""}`, ELECTRON_RUN_AS_NODE: "1" }, timeout: 60_000 }, (err, stdout) => {
			if (err) return resolve(null);
			try {
				const parsed = JSON.parse(String(stdout));
				resolve(parsed && Array.isArray(parsed.models) ? { model: typeof parsed.model === "string" ? parsed.model : null, models: parsed.models } : null);
			} catch {
				resolve(null);
			}
		});
	});
	modelsAsked = { at: Date.now(), answer };
	return answer;
}

/** One workspace made at a time, so two asked for at once cannot both pick the same city. */
let making = Promise.resolve();

/** What each new workspace is to be told first, until its page takes it — see firstSpec.js. */
const waiting = firsts();

/**
 * A new workspace of a repository in the list, for the spec `first` starts,
 * and the window put on it. Only for one: a workspace is made by the new spec
 * dialog and by nothing else (spec-mode.md 6절), so there is no way here to
 * make an empty one. `from` is the remote's branch to start it from, when it
 * is not to be the default one — git.js looks for it, and refuses what is not
 * there. Says why not, for the dialog to say it beside the line typed, which
 * is still there.
 */
function newWorkspace(root, first, from) {
	const told = firstFrom(first);
	if (!told) return Promise.resolve({ error: "Say what to build, in a line." });
	const made = making.then(async () => {
		const project = projectsOf(readSettings(), isCheckout).find((project) => project.path === root);
		if (!project) return { error: "That repository is no longer on the list." };
		try {
			const worktree = await makeWorkspace(root, { into: join(home(), "workspaces", basename(root)), owner: await login(), start: typeof from === "string" && from ? from : null, retired: project.retired });
			writeSettings({ ...readSettings(), projects: withWorkspace(projectsOf(readSettings(), isCheckout), root, worktree) });
			waiting.keep(worktree.path, told);
			workspacesChanged();
			return { worktree };
		} catch (err) {
			return { error: err.message };
		}
	});
	making = made.then(() => {});
	// Set up outside the one-at-a-time: an install can take minutes, and the
	// list need not wait on it. Set up and failed, the workspace stays on the
	// list with its first message, to be opened as it is or set up again.
	return made.then(async ({ worktree, error }) => {
		if (error) return { error };
		const setup = await setUp(root, worktree.path);
		if (setup.error) return { error: setup.error };
		void show(worktree.path);
		return {};
	});
}

/** Tell the page a workspace's setup is running (`"running"`) or has ended (null) — the dialog says so while it waits. */
function setupChanged(path, stage) {
	if (window && !window.isDestroyed()) window.webContents.send("workspace:setup", path, stage);
}

/**
 * The repository's own setup, run in a workspace: the command its
 * `.octave/config.toml` names (octaveConfig.js), to its end, with the
 * repository's folder in `OCTAVE_REPOSITORY` and the output's tail in the
 * workspace's `.pi/runs/setup.log` (scripts.js). `{ ran: false }` where the
 * file names none; `{ error }` — a config that could not be read, or a
 * command that did not exit 0 — says why, with the log's place.
 */
async function setUp(root, path) {
	const config = readConfig(path);
	if (!isConfig(config)) return { error: config.error };
	if (!config.setup) return { ran: false };
	setupChanged(path, "running");
	try {
		const ran = await runScript({ name: "setup", command: config.setup, cwd: path, env: { ...process.env, OCTAVE_REPOSITORY: root }, timeout: DEFAULT_TIMEOUT });
		if (ran.exit !== 0) return { error: `Setup failed (exit ${ran.exit})${ran.last ? `: ${ran.last}` : ""}. The whole of it is in .pi/runs/setup.log in the workspace.` };
		return { ran: true };
	} finally {
		setupChanged(path, null);
	}
}

/**
 * The repository's own archive command run in a workspace about to be
 * removed — a database dropped, a tunnel closed. Nothing stands in the
 * removal's way: what went wrong is answered as a warning, since the folder,
 * and the log in it, will be gone.
 */
async function archive(root, path) {
	const config = readConfig(path);
	if (!isConfig(config)) return `The workspace was removed without its archive command: ${config.error}`;
	if (!config.archive) return null;
	const ran = await runScript({ name: "archive", command: config.archive, cwd: path, env: { ...process.env, OCTAVE_REPOSITORY: root }, timeout: DEFAULT_TIMEOUT });
	return ran.exit === 0 ? null : `The workspace was removed, but its archive command failed (exit ${ran.exit})${ran.last ? `: ${ran.last}` : ""}.`;
}

/** Tell the page how a workspace's run stands — see runs.js `stateOf`, and RunButton.tsx. */
function runChanged(path, state) {
	if (window && !window.isDestroyed()) window.webContents.send("run:changed", path, runState(path, state));
}

/** The repository's own runs in its workspaces, one each — see runs.js. */
const runs = createRuns({ onChange: runChanged });

/**
 * What the foot of the window shows of the repository's commands, in a
 * workspace: whether the repository has the file at all — without it the
 * word there is `Set up` — and the default of its `[scripts.run.*]`
 * (octaveConfig.js), null where there is none, else what runs.js says of
 * it under the run's id, which is the button's word when nothing is running.
 */
function runState(path, state = runs.stateOf(path)) {
	const configured = existsSync(join(path, CONFIG_FILE));
	const config = readConfig(path);
	const run = isConfig(config) ? config.run.find((r) => r.default) ?? null : null;
	return { configured, run: run ? { ...state, id: state.id ?? run.id } : null };
}

/** The default run started in a listed workspace, on the port kept for it. */
async function startRun(path) {
	const root = repositoryOfWorkspace(path);
	if (!root) return { error: "That workspace is no longer on the list." };
	const config = readConfig(path);
	if (!isConfig(config)) return { error: config.error };
	const run = config.run.find((r) => r.default);
	if (!run) return { error: "This repository names no run command in .octave/config.toml." };
	const port = await freePort(runPorts.get(path));
	runPorts.set(path, port);
	return { state: runState(path, runs.start(path, { id: run.id, command: run.command, port, env: { ...process.env, OCTAVE_REPOSITORY: root } })) };
}

/** Setup run again in a listed workspace, from its row — after it failed, or after the command was changed. */
function setUpAgain(path) {
	const root = repositoryOfWorkspace(path);
	if (!root) return Promise.resolve({ error: "That workspace is no longer on the list." });
	return setUp(root, path);
}

/** The repository a listed workspace is of, or null for a folder that is not one: the page does not name folders of its own. */
const repositoryOfWorkspace = (path) => projectsOf(readSettings(), isCheckout).find((project) => project.worktrees.some((worktree) => worktree.path === path))?.path ?? null;

/** How many uncommitted changes a listed workspace holds, for the person to be told before it is removed; null when git cannot say. */
async function workspaceChanges(path) {
	if (!repositoryOfWorkspace(path)) return null;
	return changesIn(path).catch(() => null);
}

/**
 * A workspace removed: its server stopped, its folder and worktree taken
 * away, and its row off the list. The branch stays, and so does what was
 * said in it — pi keeps a conversation by its folder's path (spec-mode.md
 * 6절). `seen` is how many uncommitted changes the person was told would go
 * with it: when the folder holds another number by now, nothing is removed
 * and the number is answered instead, to be asked about again. Not while the
 * agent is working there. One at a time with making, which reads the same
 * folders. The window, if it was on this one, goes to the first screen.
 * The repository's own `archive` command, if it names one, runs in the
 * folder first; one that fails does not keep the folder — `{ warning }`
 * says how it went, with the removal done.
 */
function removeWorkspace(path, seen) {
	const done = making.then(async () => {
		const root = repositoryOfWorkspace(path);
		if (!root) return { error: "That workspace is no longer on the list." };
		if (busy.get(path)) return { error: "The agent is working there. Remove it when it has finished." };
		try {
			const changes = await changesIn(path);
			if (changes !== seen) return { changes };
			if (path === front || path === wanted) await showStart();
			await servers.stop(path);
			await runs.stop(path);
			const warning = await archive(root, path);
			await removeWorktree(root, path);
			writeSettings({ ...readSettings(), projects: withoutWorkspace(projectsOf(readSettings(), isCheckout), path) });
			waiting.take(path);
			for (const kept of [ports, runPorts, busy, since]) kept.delete(path);
			runs.forget(path);
			workspacesChanged();
			return warning ? { warning } : {};
		} catch (err) {
			return { error: err.message };
		}
	});
	making = done.then(() => {});
	return done;
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
 * A repository chosen in the Finder and added to the list. A folder anywhere
 * inside a repository adds that repository. Says why not when the folder is
 * in none; a choice cancelled says nothing.
 */
async function openLocalRepository() {
	const picked = await askForRepository();
	if (!picked) return null;
	const root = await repositoryOf(picked);
	if (!root) return { error: `${basename(picked)} is not in a git repository.` };
	addRepository(root);
	return {};
}

/**
 * A repository's clone added to the list, and nothing more: no workspace is
 * made of it and the window stays where it is. A workspace is made, and
 * opened, when the person asks for one — spec-mode.md 6절.
 */
function addRepository(root) {
	writeSettings({ ...readSettings(), projects: withWorkspace(projectsOf(readSettings(), isCheckout), root) });
	workspacesChanged();
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
	addRepository(into);
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
	// The open issues of a repository on the list, for a spec to start from one.
	ipcMain.handle("github:issues", (_event, root) => (devUrl || !projectsOf(readSettings(), isCheckout).some((project) => project.path === root) ? null : issues(root)));
	// The list, and the two things done to it. In a dev run the dev server owns
	// the folder, so there is no list to switch in.
	ipcMain.handle("workspaces", () => (devUrl ? null : workspaces()));
	// The models a spec can be started on, for the first screen: asked of pi
	// in a process of its own, since there is no server there to ask.
	ipcMain.handle("models", () => (devUrl ? null : modelsForHome()));
	ipcMain.handle("workspace:new", (_event, root, first, from) => (devUrl ? null : newWorkspace(root, first, from)));
	// The branches of a repository on the list that a workspace can start from.
	ipcMain.handle("workspace:branches", (_event, root) =>
		devUrl || !projectsOf(readSettings(), isCheckout).some((project) => project.path === root) ? null : remoteBranches(root).catch(() => null),
	);
	// Asked by a page for its own workspace, which it names: the one in front
	// is where the window is going, and a page still up while it goes there
	// would be given the wrong workspace's line.
	ipcMain.handle("workspace:first", (_event, folder) => (typeof folder === "string" ? waiting.take(folder) : null));
	ipcMain.handle("workspace:open", (_event, path) => (devUrl ? null : openWorkspace(path)));
	ipcMain.handle("workspace:changes", (_event, path) => (devUrl ? null : workspaceChanges(path)));
	ipcMain.handle("workspace:remove", (_event, path, seen) => (devUrl ? null : removeWorkspace(path, seen)));
	ipcMain.handle("workspace:setup", (_event, path) => (devUrl ? null : setUpAgain(path)));
	ipcMain.handle("run:state", (_event, path) => (devUrl ? null : runState(path)));
	ipcMain.handle("run:start", (_event, path) => (devUrl ? null : startRun(path)));
	ipcMain.handle("run:stop", (_event, path) => (devUrl ? null : runs.stop(path).then(() => runState(path))));
	// A note in the Finder. The page is told the folder in full by the server
	// (ConfigMsg.folder) and joins the note's path onto it, which is a better
	// source than this process has: in a dev run the settings hold no workdir
	// at all. showItemInFolder on a path that is not there does nothing, which
	// is the right amount of fuss for a file that was just deleted.
	ipcMain.handle("file:reveal", (_event, path) => shell.showItemInFolder(path));
	// The editors this machine has, and a file opened in one — see editors.js.
	// The icon comes back as a data URL: a NativeImage cannot cross to the page,
	// and what the page wants of it is a src.
	ipcMain.handle("editors", async () => {
		const found = await editorsOn((scheme) => app.getApplicationInfoForProtocol(scheme));
		return found.map(({ scheme, name, icon }) => ({ scheme, name, icon: icon?.isEmpty() === false ? icon.toDataURL() : null }));
	});
	ipcMain.handle("editor:open", async (_event, { scheme, file, line }) => {
		// Asked again rather than remembered: what is installed can change
		// between the menu being drawn and an item in it being chosen, and this
		// is also where the app's path — which the opening needs — comes from.
		const editor = (await editorsOn((s) => app.getApplicationInfoForProtocol(s))).find((one) => one.scheme === scheme);
		const opening = editor && openingOf(scheme, editor.path, file, line);
		if (!opening) return { error: "That editor is no longer there." };
		try {
			if (opening.url) await shell.openExternal(opening.url);
			else {
				// Let go of it: this starts an app, and an app outlives the click.
				// Checked first, because a spawn that fails does so on an event
				// nobody is left to hear.
				if (!existsSync(opening.command)) return { error: `${editor.name} has no command to open a file with.` };
				spawn(opening.command, opening.args, { detached: true, stdio: "ignore" }).unref();
			}
			return {};
		} catch (error) {
			return { error: String(error?.message ?? error) };
		}
	});
}

/**
 * What the page keeps about the window — see prefs.js. Given whole and at
 * once as a page loads (sendSync, from the preload), since the theme is read
 * before the first paint; a change is one key, written through.
 */
function servePrefs() {
	ipcMain.on("prefs", (event) => {
		event.returnValue = prefsOf(readSettings());
	});
	ipcMain.on("prefs:set", (_event, key, value) => {
		const settings = readSettings();
		const was = prefsOf(settings);
		const next = withPref(was, key, value);
		if (next !== was) writeSettings({ ...settings, prefs: next });
	});
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
					// The page's to open, since the dialog is the page's: over whichever
					// repository is in front, and changed there. With Shift, as Conductor
					// has it — ⌘N alone is the page's own, for a note.
					{ label: "New Spec…", accelerator: "CmdOrCtrl+Shift+N", click: () => window && !window.isDestroyed() && window.webContents.send("new-spec") },
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
	servePrefs();
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
	// A link on a page — in a note, in the agent's answer, on the sign-in
	// screen — opens in the Mac's browser. Left to itself the window would
	// navigate to it, or open a second window of the app on it: the app has
	// one window, on its own pages and its servers. Anything else is the
	// browser's. `will-navigate` is a plain link; `setWindowOpenHandler` is
	// target="_blank" and window.open.
	const ours = (url) => url.startsWith(`${SCHEME}://`) || url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:") || (devUrl ? url.startsWith(devUrl) : false);
	const outside = (url) => /^https?:$/.test(new URL(url).protocol) && !ours(url);
	window.webContents.on("will-navigate", (event, url) => {
		if (!outside(url)) return;
		event.preventDefault();
		void shell.openExternal(url);
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (outside(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
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
