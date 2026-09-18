/**
 * The one thing the page cannot do for itself: change the folder.
 *
 * Everything else it needs it asks the server for over the websocket, and the
 * server answers for the folder it was started in. Choosing a different one is
 * a native dialog and a relaunch — both the shell's, neither reachable from a
 * page — so that much, and only that much, is handed across.
 *
 * CommonJS, since a sandboxed preload cannot import modules; the sandbox is
 * worth more than the syntax.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pi", {
	/** The folder now, and the ones before it. Null current means a dev run, where the folder is the dev server's. */
	folders: () => ipcRenderer.invoke("folders"),
	/** Ask for a folder and open it. Nothing happens if the dialog is cancelled. */
	choose: () => ipcRenderer.invoke("folder:choose"),
	/** Open one already known. */
	open: (path) => ipcRenderer.invoke("folder:open", path),
	/** Show a file in the Finder. Takes the whole path; the page knows it. */
	reveal: (path) => ipcRenderer.invoke("file:reveal", path),
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
});
