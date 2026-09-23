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
	/** Servers stopped on purpose, one at a time, whose exit is not a crash. */
	const retired = new WeakSet();
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
					if (!stopping && !retired.has(server)) onCrash(workdir, code, server);
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

	/** Stop one folder's server, if it has one; the next ask starts it afresh. */
	async function stop(workdir) {
		const entry = running.get(workdir);
		if (!entry) return;
		running.delete(workdir);
		const server = await entry.catch(() => null);
		if (!server) return;
		retired.add(server);
		await end(server.child);
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
		stop,
		stopAll,
		/** The folders with a server running or starting. */
		folders: () => [...running.keys()],
		/** Every server there is once it has started; one that failed to is skipped. */
		each: async (fn) => {
			for (const entry of await Promise.allSettled([...running.values()])) if (entry.status === "fulfilled") fn(entry.value);
		},
		/** How many are running or starting. */
		get size() {
			return running.size;
		},
	};
}

/**
 * The folders whose servers can be stopped now: running, not the one in
 * front or the one being switched to, not in the middle of a run, and left
 * alone for `idleMs` — since they were last in front or last finished a run,
 * whichever was later. A server is cheap to start again and a run is not, so
 * the rule stops only what nobody is using and nothing is doing.
 */
export function idle(folders, { keep, busy, since, now, idleMs }) {
	return folders.filter((workdir) => !keep.includes(workdir) && !busy.get(workdir) && now - (since.get(workdir) ?? 0) >= idleMs);
}
