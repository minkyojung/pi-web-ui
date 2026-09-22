/**
 * The repository's `run` command (octaveConfig.js) running in a workspace —
 * a dev server, a watcher — for as long as the person leaves it: started and
 * stopped from the foot of the window, one at a time in a workspace, with
 * what it prints going to `.pi/runs/<id>.log` there as it comes. Each
 * workspace's run is told a port of its own in `OCTAVE_PORT`, so two
 * workspaces of one repository can run at once.
 *
 * Stopping asks first and insists after, as servers.js does: SIGTERM to the
 * command's whole process group — the shell and what it started — then
 * SIGKILL `graceMs` later. A run that ends on its own is remembered by how
 * it ended, since a dev server that died is the one thing worth a red word.
 * Pure: how a run is started and stopped, told by `onChange` — tested with
 * no window.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

export function createRuns({ onChange, graceMs = 3000 }) {
	/** Folder → the run in it. */
	const running = new Map();
	/** Folder → how the last run there ended on its own, until the next starts. */
	const ended = new Map();

	/** `{ running, id, port, exit }`: exit is the code of a run that ended on its own, and null otherwise. */
	function stateOf(workdir) {
		const on = running.get(workdir);
		if (on) return { running: true, id: on.id, port: on.port, exit: null };
		const was = ended.get(workdir) ?? null;
		return { running: false, id: was?.id ?? null, port: null, exit: was?.exit ?? null };
	}

	const signal = (child, sig) => {
		try {
			process.kill(-child.pid, sig);
		} catch {
			child.kill(sig);
		}
	};

	/** Start `command` as the run `id` in a folder, unless one is running there already; answers the state either way. */
	function start(workdir, { id, command, port, env }) {
		if (running.has(workdir)) return stateOf(workdir);
		ended.delete(workdir);
		const dir = join(workdir, ".pi", "runs");
		mkdirSync(dir, { recursive: true });
		const log = createWriteStream(join(dir, `${id}.log`));
		/** The log written through, which a stop waits for: a log read right after a stop is one that says how it ended. */
		const logged = new Promise((resolve) => log.once("finish", resolve));
		log.write(`$ ${command}\n`);
		const child = spawn("/bin/bash", ["-lc", command], { cwd: workdir, env: { ...env, OCTAVE_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], detached: true });
		const run = { id, port, child, stopped: false, logged };
		running.set(workdir, run);
		child.stdout.on("data", (d) => log.write(d));
		child.stderr.on("data", (d) => log.write(d));
		const gone = (exit) => {
			log.end(`(exit ${exit})\n`);
			if (running.get(workdir) !== run) return;
			running.delete(workdir);
			if (!run.stopped) ended.set(workdir, { id, exit });
			onChange(workdir, stateOf(workdir));
		};
		child.on("error", (err) => {
			log.write(`${err.message}\n`);
			gone(127);
		});
		child.on("close", (code, sig) => gone(code ?? (sig ? 128 : 127)));
		onChange(workdir, stateOf(workdir));
		return stateOf(workdir);
	}

	/** Stop the run in a folder, if there is one, and wait for it to be gone. */
	async function stop(workdir) {
		const run = running.get(workdir);
		if (!run) return;
		run.stopped = true;
		const { child } = run;
		if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
		const closed = new Promise((resolve) => child.once("close", resolve));
		signal(child, "SIGTERM");
		const hard = setTimeout(() => signal(child, "SIGKILL"), graceMs);
		await closed;
		clearTimeout(hard);
		await run.logged;
	}

	return {
		start,
		stop,
		stateOf,
		/** Every run stopped, on the way out. */
		stopAll: () => Promise.all([...running.keys()].map(stop)).then(() => {}),
		/** Forget a folder that is gone. */
		forget: (workdir) => void ended.delete(workdir),
	};
}
