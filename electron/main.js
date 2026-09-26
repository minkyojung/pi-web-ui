/**
 * The desktop shell.
 *
 * The server owns the pi session and is the only thing that can talk to it, so
 * the app is a window pointed at it rather than a rewrite of it. It runs as a
 * child process: a crash in the agent then takes down something the shell can
 * report on, rather than the shell itself.
 */
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { copyInto } from "./copies.js";
import { runLogsIn } from "./runLogs.js";
import { createRuns } from "./runs.js";
import { runScript } from "./scripts.js";
import { createServerProcess } from "./serverProcess.js";
import { shellEnv } from "./shellEnv.js";
import { addBranchWorktree, branchOf, changesIn, git, headOf, identity, makeWorkspace, onRemote, remoteBranches, removeWorktree, repositoryOf, setIdentity } from "./git.js";
import { allowEmail, clone, commitChoices, issues, login, mergePullRequest, pullRequests, repositories, repositoryName, signIn, signOut, standing } from "./github.js";
import { KEYS, forget, gitEnv } from "./credentials.js";
import { editorsOn, openingOf } from "./editors.js";
import { firstFrom, firsts } from "./firstSpec.js";
import { switchLine } from "./switching.js";
import { firstWorkspace, hiddenRepository, projectsOf, remembered, reordered, statusOf, withWorkspace, workspaceState } from "./workspaces.js";

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
	// The port the server had before, if it is free: nothing of the page's is
	// kept by it (web/src/workspace.ts), but a server started again after a
	// crash is found where it was.
	port = await freePort(port);
	named.clear();
	named.add(resolve(workdir));
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
	// The person's GitHub sign-in goes with it, for the agent's git and gh —
	// see credentials.js.
	const child = spawn(process.execPath, [here("../dist-server/server.mjs")], {
		env: {
			...process.env,
			...(await gitEnv()),
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
	answerTrashAsks(child);
	openUrlAsks(child);
	answerDisposals(child);
	child.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
	child.stderr.on("data", (d) => {
		process.stderr.write(`[server] ${d}`);
		said(String(d).split("\n").filter(Boolean));
	});
	// A failed spawn emits 'error', not 'exit', and without this the shell would
	// sit forever waiting for a server that was never going to start.
	child.on("error", (err) => said([`Could not start the pi server: ${err.message}`]));
	// Which folders the agent is in the middle of a turn in, so none is removed under it.
	child.on("message", (message) => {
		if (typeof message?.busy !== "boolean" || typeof message.folder !== "string") return;
		busy.set(resolve(message.folder), message.busy);
	});
	return { child, url: `http://${HOST}:${port}/`, errors };
}

/**
 * A folder named to the server, which then serves it: told before the window
 * is pointed at it, and again ahead of a click (`warm`) — the server makes
 * the folder's workspace the first time and keeps it. Every folder named
 * is remembered here, since the trash asks (below) are answered for those
 * and no other.
 */
async function nameFolder(workdir, { warm = false } = {}) {
	const server = await servers.get(workdir);
	const full = resolve(workdir);
	named.add(full);
	if (server.child.connected) server.child.send(warm ? { workspace: full, warm: full } : { workspace: full });
	return server;
}

/**
 * A folder let go of by the server — its watcher, its session, its tabs —
 * so it can be removed. Waited for, up to a moment: a folder deleted under
 * a watcher that is still on it is a folder deleted with a fight.
 */
function disposeFolder(workdir) {
	const full = resolve(workdir);
	named.delete(full);
	busy.delete(full);
	return servers.current().then((server) => {
		if (!server?.child.connected) return;
		return new Promise((done) => {
			const timer = setTimeout(done, 3000);
			disposals.set(full, () => {
				clearTimeout(timer);
				done();
			});
			server.child.send({ dispose: full });
		});
	});
}

/** Whoever is waiting for a folder to be let go of, by folder — see disposeFolder. */
const disposals = new Map();
function answerDisposals(server) {
	server.on("message", (message) => {
		if (typeof message?.disposed !== "string") return;
		const waiting = disposals.get(message.disposed);
		disposals.delete(message.disposed);
		waiting?.();
	});
}

/** The server's port for as long as the app runs. */
let port;
/** The folders the server has been told of — the ones it works in. */
const named = new Set();
/** Each folder's port for the repository's own run command — `OCTAVE_PORT`, kept the same for as long as the app runs, as the server's is. */
const runPorts = new Map();
/** Whether the agent is in the middle of a turn in each folder. */
const busy = new Map();

/**
 * The server — see serverProcess.js. One that stops unasked says why and,
 * with a workspace in front, takes the app with it, since the window has
 * nothing left to show; on the first screen the app stays, and the server
 * is started again when a workspace is next opened.
 */
const servers = createServerProcess({
	start: startServer,
	onCrash: (code, server) => {
		const why = server.errors.length ? server.errors.join("\n") : `Exit code ${code}. Check the terminal output.`;
		busy.clear();
		dialog.showErrorBox("The server stopped", why);
		if (front) app.quit();
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
/** The approval under way — a sign-in, or letting one read email — if one is; a second ask while it goes is the same one. */
let signingIn = null;

/**
 * One of gh's approvals (github.js signIn, allowEmail), with the code gh gets
 * shown on the page; the token may be a new one after either, so the servers
 * are told.
 */
async function authorizeGitHub(page, flow) {
	if (signingIn) return { error: "A sign-in is already under way." };
	signingIn = new AbortController();
	try {
		const out = await flow({ signal: signingIn.signal, onCode: (code) => !page.isDestroyed() && page.send("github:code", code) });
		if (out.ok) await tellCredentials();
		return out;
	} finally {
		signingIn = null;
	}
}

/**
 * The person's GitHub sign-in changed: every server running gets what git
 * and gh are to run with from now on — the same variables it was started
 * with (startServer), set anew — so the agent's next push has it without the
 * workspace being reopened. The system prompt's line about it stands until
 * the session is next made; it says what to do when a push fails, and one
 * will not now.
 */
async function tellCredentials() {
	forget();
	const set = await gitEnv();
	const server = await servers.current();
	if (server?.child.connected) server.child.send({ credentials: { unset: KEYS, set } });
}

function answerTrashAsks(server) {
	server.on("message", async (message) => {
		if (message?.ask !== "trash" || typeof message.id !== "number" || typeof message.path !== "string") return;
		let ok = false;
		const path = resolve(message.path);
		if ([...named].some((root) => path.startsWith(root + sep))) {
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
	await Promise.all([servers.stop(), runs.stopAll()]);
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
		await Promise.all([servers.stop(), runs.stopAll()]);
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
	const timing = { from: front, to: workdir, shell: { asked: Date.now() }, page: null };
	let url;
	try {
		({ url } = await nameFolder(workdir));
		timing.shell.server = Date.now();
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
	timing.shell.answered = Date.now();
	if (mine !== asked) return;
	front = workdir;
	wanted = null;
	// The workspace to open on the next start — see firstWorkspace.
	writeSettings({ ...readSettings(), workdir });
	// The agent acts on this folder, so it should never be a guess.
	window.setTitle(`Octave — ${basename(workdir)}`);
	// A page already up on the server is told, and moves in place — its
	// stores, its socket, its tree, and nothing else (web/src/switch.ts). One
	// not yet, or on the first screen, is loaded: which folder it is a window
	// on goes on its address, since one server serves them all and the page
	// says which it means (web/src/workspace.ts). A load cut short by the next
	// switch is that switch's to finish.
	if (window.webContents.getURL().startsWith(url)) window.webContents.send("workspace:show", workdir);
	else await window.loadURL(`${url}?folder=${encodeURIComponent(workdir)}`).catch((err) => console.error(`[window] ${err.message}`));
	timing.shell.loaded = Date.now();
	landing(timing);
}

/**
 * The switch whose page has yet to say it is ready. One line per switch in
 * the server's log, with both halves (switching.js): written when the page
 * reports, or with the shell's half alone if it has not within a while — a
 * page that never got there is worth knowing about too.
 */
let landingSoon = null;
function landing(timing) {
	if (landingSoon) landed(null);
	landingSoon = { timing, later: setTimeout(() => landed(null), 15_000) };
}
function landed(page) {
	if (!landingSoon) return;
	const { timing, later } = landingSoon;
	clearTimeout(later);
	landingSoon = null;
	const line = switchLine({ ...timing, page });
	console.log(line);
	try {
		mkdirSync(join(logPath(), ".."), { recursive: true });
		appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`);
	} catch {
		// The console has it; a log that cannot be written is not this line's problem.
	}
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
	// A repository taken off the list is still in the settings, so that adding
	// it again brings back its workspaces — it is left out here (workspaces.js).
	const projects = projectsOf(readSettings(), isCheckout).filter((project) => !project.hidden);
	// Which of these a page is on is not said here: the page knows its own
	// folder from its server, and the one in front is where the window is
	// going, which a page still up while it goes there is not.
	return {
		projects: await Promise.all(
			projects.map(async (project) => {
				const prs = pullRequestsOf(project.path);
				return {
					path: project.path,
					name: basename(project.path),
					worktrees: await Promise.all(
						project.worktrees.map(async (worktree) => {
							// An archived workspace has no folder to read a branch out of;
							// the name it was archived under is the one it kept.
							const branch = (worktree.state ? null : await branchOf(worktree.path)) ?? worktree.branch;
							// Where the branch stands, for the row to say: git's word, and
							// GitHub's when gh can give it. A workspace whose branch git
							// cannot read is listed as only here. The clone is what is
							// asked, so an archived row says it too.
							const remote = await onRemote(project.path, branch).catch(() => false);
							return { path: worktree.path, name: worktree.name, branch, state: worktree.state ?? null, at: worktree.at ?? null, status: statusOf({ onRemote: remote, pr: prs?.get(branch) ?? null }) };
						}),
					),
				};
			}),
		),
	};
}

/**
 * A repository's pull requests by branch, as gh last said — at once, with gh
 * asked again when that is over half a minute old and the list drawn again
 * when it answers. The list is drawn at every change and every focus, and at
 * every switch, since the page is new there; waiting on GitHub for it was two
 * seconds of an empty sidebar each time. Not known yet is null, which the
 * rows read as git's word alone until the answer lands.
 */
const pullRequestsOf = remembered({ ask: (root) => branchesOf(root).then((branches) => pullRequests(root, branches)), onFresh: workspacesChanged, staleMs: 30_000 });

/**
 * The pull request of the workspace at `path` merged, from the foot of its
 * window — and, when GitHub took it, the repository's pull requests asked
 * about again at once, so the item says merged now rather than half a
 * minute on.
 */
async function mergeFrom(path, number, method) {
	const project = projectsOf(readSettings(), isCheckout).find((one) => one.worktrees.some((worktree) => worktree.path === path));
	if (!project) return { error: "This workspace is not in the list." };
	const merged = await mergePullRequest(path, number, method);
	if (!merged.error) {
		pullRequestsOf.again(project.path);
		workspacesChanged();
	}
	return merged;
}

/** The branches the repository's workspaces are on now — what GitHub is asked about, and nothing else. */
async function branchesOf(root) {
	const project = projectsOf(readSettings(), isCheckout).find((p) => p.path === root);
	const branches = await Promise.all((project?.worktrees ?? []).map(async (worktree) => (await branchOf(worktree.path)) ?? worktree.branch));
	return [...new Set(branches)];
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
			const worktree = await makeWorkspace(root, { into: join(home(), "workspaces", basename(root)), owner: await login(), start: typeof from === "string" && from ? from : null, retired: [...project.retired, ...project.worktrees.map((worktree) => worktree.name)] });
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
 * workspace's `.pi/runs/setup.log` (scripts.js), after the files the config
 * says to copy from the clone are (copies.js). `{ ran: false }` where the
 * file names no setup; `{ error }` — a config that could not be read, or a
 * command that did not exit 0 — says why, with the log's place.
 */
async function setUp(root, path) {
	const config = readConfig(path);
	if (!isConfig(config)) return { error: config.error };
	// What is kept beside the code and out of git comes over first, so the
	// setup finds it there — an `.env` the install reads, say (copies.js).
	copyInto(root, path, config.copy);
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
 * word there is `Set up` — the ids of its `[scripts.run.*]` (octaveConfig.js)
 * for the menu, `run` as what runs.js says of the one running or last
 * ended, under the default's id when none has run yet — the button's word —
 * and the logs the commands have left there (runLogs.js), for the menu.
 */
function runState(path, state = runs.stateOf(path)) {
	const configured = existsSync(join(path, CONFIG_FILE));
	const config = readConfig(path);
	const named = isConfig(config) ? config.run : [];
	const fallback = named.find((r) => r.default) ?? null;
	return { configured, runs: named.map((r) => r.id), run: fallback ? { ...state, id: state.id ?? fallback.id } : null, logs: runLogsIn(path) };
}

/** A run started in a listed workspace — the one named, else the default — on the port kept for it. One at a time in a workspace (runs.js). */
async function startRun(path, id = null) {
	const root = repositoryOfWorkspace(path);
	if (!root) return { error: "That workspace is no longer on the list." };
	const config = readConfig(path);
	if (!isConfig(config)) return { error: config.error };
	const run = id === null ? config.run.find((r) => r.default) : config.run.find((r) => r.id === id);
	if (!run) return { error: id === null ? "This repository names no run command in .octave/config.toml." : `This repository names no run "${id}" in .octave/config.toml.` };
	if (runs.stateOf(path).running) return { error: `${runs.stateOf(path).id} is running here. Stop it first: one run at a time in a workspace.` };
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
 * A workspace archived: its server stopped, its folder and worktree given
 * back, and its row kept — Conductor's Archive. What is not the folder stays:
 * the branch with every commit on it, the commit it stood on, written down
 * for the row, and what was said in it, since pi keeps a conversation by its
 * folder's path (spec-mode.md 6절). So it can be brought back (restoreWorkspace).
 *
 * `seen` is how many uncommitted changes the person was told would go with
 * the folder — the one thing archiving does not keep: when the folder holds
 * another number by now, nothing is done and the number is answered instead,
 * to be asked about again. Not while the agent is working there. One at a
 * time with making, which reads the same folders. The window, if it was on
 * this one, goes to the first screen. The repository's own `archive`
 * command, if it names one, runs in the folder first; one that fails does
 * not keep the folder — `{ warning }` says how it went, with the archiving
 * done.
 *
 * The row is marked `archiving` before the folder goes and `archived` after,
 * so a shell that dies in between leaves a row that says what was happening
 * rather than one that points at a folder nobody can find (finishArchiving).
 */
function archiveWorkspace(path, seen) {
	const done = making.then(async () => {
		const root = repositoryOfWorkspace(path);
		if (!root) return { error: "That workspace is no longer on the list." };
		if (busy.get(path)) return { error: "The agent is working there. Archive it when it has finished." };
		try {
			const changes = await changesIn(path);
			if (changes !== seen) return { changes };
			const commit = await headOf(path);
			if (path === front || path === wanted) await showStart();
			await disposeFolder(path);
			await runs.stop(path);
			const warning = await archive(root, path);
			writeSettings({ ...readSettings(), projects: workspaceState(projectsOf(readSettings(), isCheckout), path, "archiving", { commit }) });
			await removeWorktree(root, path);
			writeSettings({ ...readSettings(), projects: workspaceState(projectsOf(readSettings(), isCheckout), path, "archived", { at: new Date().toISOString() }) });
			waiting.take(path);
			runPorts.delete(path);
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

/**
 * An archived workspace brought back and opened: the worktree made again
 * where it stood, on the branch it kept, then what the repository keeps out
 * of git copied in and its setup run — a worktree has only what is committed
 * — and the window put on it. The conversation is the one that was there,
 * pi keeping it by the folder's path.
 *
 * Says why not in git's words: a branch deleted since, one another workspace
 * has checked out, a folder in the way. Set up outside the one at a time, as
 * a new workspace is, and a setup that fails leaves the workspace on the
 * list to be opened as it is or set up again.
 */
function restoreWorkspace(path) {
	const made = making.then(async () => {
		const root = repositoryOfWorkspace(path);
		if (!root) return { error: "That workspace is no longer on the list." };
		const worktree = projectsOf(readSettings(), isCheckout).find((project) => project.path === root).worktrees.find((w) => w.path === path);
		if (!worktree.state) return { error: "That workspace is not archived." };
		if (existsSync(path)) return { error: `There is already a folder at ${path}.` };
		try {
			await addBranchWorktree(root, { path, branch: worktree.branch });
			writeSettings({ ...readSettings(), projects: workspaceState(projectsOf(readSettings(), isCheckout), path, null) });
			workspacesChanged();
			return { root };
		} catch (err) {
			return { error: err.message };
		}
	});
	making = made.then(() => {});
	return made.then(async ({ root, error }) => {
		if (error) return { error };
		const setup = await setUp(root, path);
		if (setup.error) return { error: setup.error };
		void show(path);
		return {};
	});
}

/**
 * Any workspace whose archiving was interrupted, finished at the next start:
 * the folder taken away if it is still there, and the row marked archived.
 * A row left saying `archiving` is the one thing a crash in the middle can
 * leave behind, and this is the one place it is read.
 */
async function finishArchiving() {
	for (const project of projectsOf(readSettings(), isCheckout)) {
		for (const worktree of project.worktrees.filter((w) => w.state === "archiving")) {
			await removeWorktree(project.path, worktree.path).catch(() => {});
			writeSettings({ ...readSettings(), projects: workspaceState(projectsOf(readSettings(), isCheckout), worktree.path, "archived", { at: new Date().toISOString() }) });
		}
	}
}

/**
 * A workspace from the list put in front. Only one on the list, and not an
 * archived one, whose folder is not there: the page does not name folders of
 * its own. Answered when the window is there or the switch has failed, not
 * when it is asked for — the page marks the row it chose until then, and a
 * switch that fails is a row to unmark, since the page is still the one
 * looking.
 */
async function openWorkspace(path) {
	const known = projectsOf(readSettings(), isCheckout).some((project) => project.worktrees.some((worktree) => worktree.path === path && !worktree.state));
	if (known) await show(path);
}

/**
 * A listed workspace made ready now, before anyone asks for the window to
 * go there: the page asks as the pointer settles on the row, and the click
 * comes a few hundred milliseconds later — time enough for the server to
 * open the folder's session and read its notes. The server keeps it, so a
 * row not chosen after all costs a folder's workspace, not a process.
 */
function warmWorkspace(path) {
	if (path === front) return;
	const known = projectsOf(readSettings(), isCheckout).some((project) => project.worktrees.some((worktree) => worktree.path === path && !worktree.state));
	// A server that will not start is the click's to report, not the hover's.
	if (known) nameFolder(path, { warm: true }).catch(() => {});
}

/** The screen that adds a repository, when there is no workspace to put in front. */
async function showStart() {
	++asked;
	wanted = null;
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
 * opened, when the person asks for one — spec-mode.md 6절. One that was taken
 * off the list is on it again, with the workspaces and the place it had.
 */
function addRepository(root) {
	const projects = withWorkspace(projectsOf(readSettings(), isCheckout), root);
	writeSettings({ ...readSettings(), projects: hiddenRepository(projects, root, false) });
	workspacesChanged();
}

/**
 * A repository taken off the list. Nothing on the disk is touched — not the
 * clone, which is the person's own folder and was theirs before the app saw
 * it, and not the workspaces made from it: the row is hidden and everything
 * it holds is kept, so adding the repository again brings all of it back
 * (workspaces.js `hiddenRepository`), which is what Conductor's hidden
 * repository does. Its workspaces' servers are stopped, since nothing is
 * going to ask for them, and the window goes to the first screen if it was
 * in one of them. Not while the agent is working in one: stopping its server
 * under it would end the turn, and there is no hurry.
 */
async function removeRepository(root) {
	const project = projectsOf(readSettings(), isCheckout).find((project) => project.path === root && !project.hidden);
	if (!project) return { error: "That repository is no longer on the list." };
	if (project.worktrees.some((worktree) => busy.get(worktree.path))) return { error: "The agent is working in one of its workspaces. Take the repository off the list when it has finished." };
	if (project.worktrees.some((worktree) => worktree.path === front || worktree.path === wanted)) await showStart();
	for (const worktree of project.worktrees) {
		await disposeFolder(worktree.path);
		await runs.stop(worktree.path);
	}
	writeSettings({ ...readSettings(), projects: hiddenRepository(projectsOf(readSettings(), isCheckout), root, true) });
	workspacesChanged();
	return {};
}

/**
 * The repositories put in the order the person dragged them into. The list is
 * theirs and always was — a new one goes at the end (workspaces.js
 * `withWorkspace`) — and this is the way to say so afterwards. Which is first
 * is not only a look: a new spec asked for from the menu, with the window on
 * no repository, opens over it.
 */
function reorderRepositories(paths) {
	writeSettings({ ...readSettings(), projects: reordered(projectsOf(readSettings(), isCheckout), paths) });
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
	ipcMain.handle("repositories:reorder", (_event, paths) => (devUrl ? null : reorderRepositories(paths)));
	ipcMain.handle("repository:remove", (_event, root) => (devUrl ? null : removeRepository(root)));
	// What the clone dialog offers, or null when gh cannot say.
	ipcMain.handle("github:repositories", () => (devUrl ? null : repositories()));
	// The open issues of a repository on the list, for a spec to start from one.
	ipcMain.handle("github:issues", (_event, root) => (devUrl || !projectsOf(readSettings(), isCheckout).some((project) => project.path === root) ? null : issues(root)));
	// Settings › Accounts: where the person stands with GitHub, and signing in
	// and out — gh's, with the code gh gets shown on the page (github.js).
	ipcMain.handle("github:standing", () => standing());
	ipcMain.handle("github:signIn", (event) => authorizeGitHub(event.sender, signIn));
	ipcMain.handle("github:allowEmail", (event) => authorizeGitHub(event.sender, allowEmail));
	ipcMain.handle("github:cancel", () => signingIn?.abort());
	ipcMain.handle("github:signOut", async () => {
		const out = await signOut();
		await tellCredentials();
		return out;
	});
	// And who git commits as on this machine, filled in from GitHub (git.js).
	ipcMain.handle("github:identity", () => identity());
	ipcMain.handle("github:commitChoices", () => commitChoices());
	ipcMain.handle("github:setIdentity", (_event, who) => setIdentity(who ?? {}));
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
	ipcMain.handle("workspace:warm", (_event, path) => (devUrl ? null : warmWorkspace(path)));
	ipcMain.handle("workspace:changes", (_event, path) => (devUrl ? null : workspaceChanges(path)));
	ipcMain.handle("workspace:archive", (_event, path, seen) => (devUrl ? null : archiveWorkspace(path, seen)));
	ipcMain.handle("workspace:restore", (_event, path) => (devUrl ? null : restoreWorkspace(path)));
	ipcMain.handle("workspace:setup", (_event, path) => (devUrl ? null : setUpAgain(path)));
	ipcMain.handle("workspace:merge", (_event, path, number, method) => (devUrl ? null : mergeFrom(path, number, method)));
	ipcMain.handle("run:state", (_event, path) => (devUrl ? null : runState(path)));
	ipcMain.handle("run:start", (_event, path, id) => (devUrl ? null : startRun(path, typeof id === "string" ? id : null)));
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
	ipcMain.on("switch:landed", (_event, marks) => {
		if (marks && typeof marks.origin === "number") landed(marks);
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
	if (!devUrl) await finishArchiving();
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
}

// Before the app is ready, as Electron requires: a scheme of the app's own
// that behaves as a web page's would, so the start page's modules load.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(main);
app.on("window-all-closed", () => app.quit());
// Once, on the way out: stopServers holds this quit back, and the one it asks
// for afterwards goes through.
app.on("before-quit", stopServers);
