/**
 * The servers, one for each folder being worked in.
 *
 * A server owns one folder's pi session and is started for it the first time
 * it is asked for — Conductor runs one agent process per workspace the same
 * way, and a folder's work then cannot stall another's, since each server is
 * one thread of its own. How a server is started is the caller's (`start`);
 * this keeps the count: one per folder however many ask at once, a server
 * that has gone started afresh, and all of them stopped together on the way
 * out.
 *
 * Stopping asks first and insists after: kill() sends SIGTERM, which the
 * server answers by retiring its extensions, cancelling the questions it has
 * open and disposing the session. `graceMs` later it is SIGKILL — a quit that
 * hangs on a server that will not stop is worse than a hard stop.
 *
 * A server that exits without having been asked to has crashed, and that is
 * `onCrash`'s to say.
 */
export function createServers({ start, onCrash, graceMs = 3000 }) {
	/** Folder → the server for it, or the promise of one still starting. */
	const running = new Map();
	let stopping = false;

	function get(workdir) {
		if (stopping) return Promise.reject(new Error("the servers are stopping"));
		const had = running.get(workdir);
		if (had) return had;
		const starting = Promise.resolve()
			.then(() => start(workdir))
			.then((server) => {
				server.child.once("exit", (code) => {
					if (running.get(workdir) === starting) running.delete(workdir);
					if (!stopping) onCrash(workdir, code, server);
				});
				return server;
			});
		running.set(workdir, starting);
		// A server that never started is not kept, so the next ask tries again.
		starting.catch(() => {
			if (running.get(workdir) === starting) running.delete(workdir);
		});
		return starting;
	}

	async function stopAll() {
		stopping = true;
		const servers = await Promise.allSettled([...running.values()]);
		await Promise.all(servers.filter((s) => s.status === "fulfilled").map((s) => end(s.value.child)));
		running.clear();
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
		stopAll,
		/** How many are running or starting. */
		get size() {
			return running.size;
		},
	};
}
