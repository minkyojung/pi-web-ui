/**
 * What the page cannot do for itself: move between workspaces and add to them.
 *
 * Everything else it needs it asks the server for over the websocket, and the
 * server answers for the folder it was started in. Another workspace is
 * another folder's server, a repository is added with a native dialog or a
 * clone — all the shell's, none reachable from a page — so that much, and
 * only that much, is handed across.
 *
 * CommonJS, since a sandboxed preload cannot import modules; the sandbox is
 * worth more than the syntax.
 */
const { contextBridge, ipcRenderer } = require("electron");

/**
 * What the page keeps about the window — the theme, the columns' widths —
 * held once by the shell (prefs.js) and read here before the page runs, so
 * the theme is known before the first paint. A set is written through and
 * kept here too, so what this page reads back is what it wrote.
 */
const prefs = ipcRenderer.sendSync("prefs");

contextBridge.exposeInMainWorld("pi", {
	prefs: {
		get: (key) => (Object.hasOwn(prefs, key) ? prefs[key] : null),
		set: (key, value) => {
			if (value === null) delete prefs[key];
			else prefs[key] = value;
			ipcRenderer.send("prefs:set", key, value);
		},
	},
	/** When this page was ready — socket, first state, drawn — for the shell's line about the switch; see web/src/landing.ts. */
	landed: (marks) => ipcRenderer.send("switch:landed", marks),
	/** Show a file in the Finder. Takes the whole path; the page knows it. */
	reveal: (path) => ipcRenderer.invoke("file:reveal", path),
	/** The models a spec can be started on, for the first screen: `{ model, models }` as the server's config has them, or null when pi could not be asked. */
	models: () => ipcRenderer.invoke("models"),
	/**
	 * A repository added to the list, and nothing opened: one chosen in the
	 * Finder, or one cloned from GitHub by owner/name or address. Each
	 * answers `{ error }` when it cannot be done, and a Finder choice
	 * cancelled answers null. `github` is the signed-in person's repositories
	 * and `issues` the open issues of one on the list — `[{ number, title,
	 * body }]` — each null when gh cannot say. `reorder` puts the list in the
	 * order `paths` names, which is the one the person dragged them into, and
	 * `remove` takes one off the list without touching anything on the disk,
	 * answering `{ error }` when it will not just now.
	 */
	repositories: {
		openLocal: () => ipcRenderer.invoke("repository:open"),
		clone: (source) => ipcRenderer.invoke("repository:clone", source),
		reorder: (paths) => ipcRenderer.invoke("repositories:reorder", paths),
		remove: (root) => ipcRenderer.invoke("repository:remove", root),
		github: () => ipcRenderer.invoke("github:repositories"),
		issues: (root) => ipcRenderer.invoke("github:issues", root),
	},
	/**
	 * The person's GitHub account, for Settings › Accounts — gh's, so the
	 * terminal is signed in too. `standing` answers `{ state }` — `missing`
	 * (no gh), `signed-out`, or `signed-in` with `login` — and `signIn` runs
	 * until GitHub says yes, saying the one-time code through `onCode` as
	 * `{ userCode, verificationUri }` on the way; it and `signOut` answer
	 * `{ ok }` or `{ error }`, and a sign-in `cancel` gave up, `{ cancelled }`.
	 * `identity` is who git commits as on this machine, `{ name, email, set }`
	 * — `set` false when git made it up — and `useGitHubIdentity` fills in
	 * what git lacks from the person signed in, answering `{}` or `{ error }`.
	 */
	github: {
		standing: () => ipcRenderer.invoke("github:standing"),
		identity: () => ipcRenderer.invoke("github:identity"),
		useGitHubIdentity: () => ipcRenderer.invoke("github:useGitHubIdentity"),
		signIn: () => ipcRenderer.invoke("github:signIn"),
		cancel: () => ipcRenderer.invoke("github:cancel"),
		signOut: () => ipcRenderer.invoke("github:signOut"),
		onCode: (listen) => {
			const handler = (_event, code) => listen(code);
			ipcRenderer.on("github:code", handler);
			return () => ipcRenderer.off("github:code", handler);
		},
	},
	/**
	 * The editors this machine has, and a file opened in one at a line — see
	 * editors.js. `list` answers `[{ scheme, name, icon }]`, newest question
	 * each time, and `open` answers `{ error }` when it could not.
	 */
	editors: {
		list: () => ipcRenderer.invoke("editors"),
		open: (scheme, file, line) => ipcRenderer.invoke("editor:open", { scheme, file, line }),
	},
	/**
	 * The repositories and their workspaces, which the shell keeps: the list,
	 * a new workspace of a repository for the spec `first` starts — `{ line,
	 * model, effort }`, started from the remote's branch `from` when one of
	 * `branches` is chosen, answered with `{ error }` when it could not be made —
	 * what the workspace at `folder` — this page's own, which the server told
	 * it — was made to be told first, given once, a
	 * workspace put in front, and one archived — `changes` says how many
	 * uncommitted changes it holds, and `archive` takes the number the person
	 * was told and answers `{ changes }` instead when it no longer holds, or
	 * `{ warning }` when it was archived but its archive command failed.
	 * `restore` makes an archived workspace's folder again, from the branch it
	 * kept, and opens it — `{ error }` when git will not have it. `setup`
	 * runs the repository's setup command again in a workspace (`{ ran }`, or
	 * `{ error }`), `merge` merges a workspace's pull request the repository's
	 * own way (`{}`, or `{ error }` with what gh said), and `onSetup` says when one's setup is running (`"running"`)
	 * or has ended (null). `onChange` says the list is to be asked for again;
	 * the listeners return the way to stop listening.
	 * The list is null in a dev run, where the dev server owns the folder.
	 */
	workspaces: {
		list: () => ipcRenderer.invoke("workspaces"),
		create: (root, first, from) => ipcRenderer.invoke("workspace:new", root, first, from),
		branches: (root) => ipcRenderer.invoke("workspace:branches", root),
		first: (folder) => ipcRenderer.invoke("workspace:first", folder),
		open: (path) => ipcRenderer.invoke("workspace:open", path),
		// Its server started ahead of `open`, while the pointer rests on its row.
		warm: (path) => ipcRenderer.invoke("workspace:warm", path),
		changes: (path) => ipcRenderer.invoke("workspace:changes", path),
		archive: (path, seen) => ipcRenderer.invoke("workspace:archive", path, seen),
		restore: (path) => ipcRenderer.invoke("workspace:restore", path),
		setup: (path) => ipcRenderer.invoke("workspace:setup", path),
		merge: (path, number, method) => ipcRenderer.invoke("workspace:merge", path, number, method),
		onSetup: (listen) => {
			const handler = (_event, path, stage) => listen(path, stage);
			ipcRenderer.on("workspace:setup", handler);
			return () => ipcRenderer.off("workspace:setup", handler);
		},
		onChange: (listen) => {
			const handler = () => listen();
			ipcRenderer.on("workspaces:changed", handler);
			return () => ipcRenderer.off("workspaces:changed", handler);
		},
		/** The window is on another workspace now, this page still up: `folder` is the one — see web/src/switch.ts. */
		onShow: (listen) => {
			const handler = (_event, folder) => listen(folder);
			ipcRenderer.on("workspace:show", handler);
			return () => ipcRenderer.off("workspace:show", handler);
		},
	},
	/**
	 * The updater, which lives in the shell: where it is, and the two things
	 * the page cannot do — ask it to look, and restart into what it has. The
	 * shell says the state as it changes; `onState` returns the way to stop
	 * listening. The page decides when what is new has been seen.
	 */
	/**
	 * The repository's own run command in this window's workspace — the
	 * default of its `[scripts.run.*]` — started and stopped from the foot of
	 * the window (Scripts.tsx). `state` is `{ configured, runs, run, logs }` —
	 * whether the repository has `.octave/config.toml` at all, the ids of its
	 * runs, the one running or last ended as `{ running, id, port, exit }` (the
	 * default's id when none has), and the logs the commands left in
	 * `.pi/runs/` as `{ name, path, exit, modified }`; `start(path, id?)` starts
	 * the run named, else the default, one at a time, and answers `{ state }` or
	 * `{ error }`; `onChange` says when it changed, and returns the way to stop listening.
	 */
	runs: {
		state: (path) => ipcRenderer.invoke("run:state", path),
		start: (path, id) => ipcRenderer.invoke("run:start", path, id),
		stop: (path) => ipcRenderer.invoke("run:stop", path),
		onChange: (listen) => {
			const handler = (_event, path, state) => listen(path, state);
			ipcRenderer.on("run:changed", handler);
			return () => ipcRenderer.off("run:changed", handler);
		},
	},
	update: {
		state: () => ipcRenderer.invoke("update:state"),
		onState: (listen) => {
			const handler = (_event, state) => listen(state);
			ipcRenderer.on("update:state", handler);
			return () => ipcRenderer.off("update:state", handler);
		},
		check: () => ipcRenderer.invoke("update:check"),
		restart: () => ipcRenderer.invoke("update:restart"),
		seen: () => ipcRenderer.invoke("update:seen"),
		dismiss: (version) => ipcRenderer.invoke("update:dismiss", version),
	},
	/** The shell asking for a page of the app's own to be opened — Help › What's New. */
	onOpenPage: (listen) => {
		const handler = (_event, page) => listen(page);
		ipcRenderer.on("open-page", handler);
		return () => ipcRenderer.off("open-page", handler);
	},
	/** The shell asking for the new spec dialog — Folder › New Spec…, ⌘⇧N. Returns the way to stop listening. */
	onNewSpec: (listen) => {
		const handler = () => listen();
		ipcRenderer.on("new-spec", handler);
		return () => ipcRenderer.off("new-spec", handler);
	},
	/** The shell asking for a section of Settings to be opened — from a menu item. */
	onOpenSettings: (listen) => {
		const handler = (_event, section) => listen(section);
		ipcRenderer.on("open-settings", handler);
		return () => ipcRenderer.off("open-settings", handler);
	},
});
