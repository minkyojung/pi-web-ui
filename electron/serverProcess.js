/**
 * The server, one for the app: the process that serves every workspace.
 *
 * Started the first time a folder is asked for — with that folder, since a
 * server is started for one and told the others afterwards (main.js) — and
 * kept for as long as the app runs. How it is started is the caller's
 * (`start`); this keeps the count: one, however many ask at once, one that
 * has gone started afresh, and stopped on the way out.
 *
 * Stopping asks first and insists after: kill() sends SIGTERM, which the
 * server answers by retiring its extensions, cancelling the questions it has
 * open and disposing every folder's session. `graceMs` later it is SIGKILL —
 * a quit that hangs on a server that will not stop is worse than a hard stop.
 *
 * A server that exits without having been asked to has crashed, and that is
 * `onCrash`'s to say.
 */
export function createServerProcess({ start, onCrash, graceMs = 3000 }) {
	/** The server, or the promise of one still starting; null between. */
	let running = null;
	/** Stopped on purpose, so its exit is not a crash. */
	const retired = new WeakSet();
	let stopping = false;

	function get(workdir) {
		if (stopping) return Promise.reject(new Error("the server is stopping"));
		if (running) return running;
		const starting = Promise.resolve()
			.then(() => start(workdir))
			.then((server) => {
				server.child.once("exit", (code) => {
					if (running === starting) running = null;
					if (!stopping && !retired.has(server)) onCrash(code, server);
				});
				return server;
			});
		running = starting;
		// A server that never started is not kept, so the next ask tries again.
		starting.catch(() => {
			if (running === starting) running = null;
		});
		return starting;
	}

	async function stop() {
		stopping = true;
		const entry = running;
		running = null;
		const server = entry ? await entry.catch(() => null) : null;
		if (!server) return;
		retired.add(server);
		await end(server.child);
	}

	async function end(child) {
		// No pid is a spawn that failed, which has nothing to stop and may never say `exit`.
		if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
		const gone = new Promise((resolve) => child.once("exit", resolve));
		child.kill();
		const hard = setTimeout(() => child.kill("SIGKILL"), graceMs);
		await gone;
		clearTimeout(hard);
	}

	return {
		get,
		stop,
		/** The server once it has started, or null while there is none or it failed to. */
		current: async () => (running ? await running.catch(() => null) : null),
		/** Whether one is running or starting. */
		get up() {
			return running !== null;
		},
	};
}
