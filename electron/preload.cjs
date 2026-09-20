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

contextBridge.exposeInMainWorld("pi", {
	/** Show a file in the Finder. Takes the whole path; the page knows it. */
	reveal: (path) => ipcRenderer.invoke("file:reveal", path),
	/**
	 * A repository added, with a workspace of it put in front: one chosen in
	 * the Finder, or one cloned from GitHub by owner/name or address. Each
	 * answers `{ error }` when it cannot be done, and a Finder choice
	 * cancelled answers null. `github` is the signed-in person's repositories,
	 * or null when gh cannot say.
	 */
	repositories: {
		openLocal: () => ipcRenderer.invoke("repository:open"),
		clone: (source) => ipcRenderer.invoke("repository:clone", source),
		github: () => ipcRenderer.invoke("github:repositories"),
	},
	/**
	 * The repositories and their workspaces, which the shell keeps: the list,
	 * a new workspace of a repository, and one put in front. `onChange` says
	 * the list is to be asked for again, and returns the way to stop listening.
	 * The list is null in a dev run, where the dev server owns the folder.
	 */
	workspaces: {
		list: () => ipcRenderer.invoke("workspaces"),
		create: (root) => ipcRenderer.invoke("workspace:new", root),
		open: (path) => ipcRenderer.invoke("workspace:open", path),
		onChange: (listen) => {
			const handler = () => listen();
			ipcRenderer.on("workspaces:changed", handler);
			return () => ipcRenderer.off("workspaces:changed", handler);
		},
	},
	/**
	 * The updater, which lives in the shell: where it is, and the two things
	 * the page cannot do — ask it to look, and restart into what it has. The
	 * shell says the state as it changes; `onState` returns the way to stop
	 * listening. The page decides when what is new has been seen.
	 */
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
	},
	/** The shell asking for a page of the app's own to be opened — Help › What's New. */
	onOpenPage: (listen) => {
		const handler = (_event, page) => listen(page);
		ipcRenderer.on("open-page", handler);
		return () => ipcRenderer.off("open-page", handler);
	},
	/** The shell asking for a section of Settings to be opened — from a menu item. */
	onOpenSettings: (listen) => {
		const handler = (_event, section) => listen(section);
		ipcRenderer.on("open-settings", handler);
		return () => ipcRenderer.off("open-settings", handler);
	},
});
