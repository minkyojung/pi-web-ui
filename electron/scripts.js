/**
 * The repository's one-shot commands run in a workspace — `setup` once it is
 * made, `archive` before it is removed (octaveConfig.js) — each to its end,
 * with its output's tail left in `.pi/runs/<name>.log`, the folder the
 * agent's checks write theirs in (spec.ts). The command is a line of bash,
 * run in a login shell as a person's would be, in the workspace, with the
 * repository's own folder in `OCTAVE_REPOSITORY` for what is copied over
 * from it — an `.env` the worktree does not have.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** As many lines of the output as the log keeps, from the end. */
export const LOG_TAIL = 40;

/** The exit code of a command that outlived its time, as timeout(1) says it; and of one that could not be started. */
export const TIMED_OUT = 124;
export const NOT_STARTED = 127;

/**
 * Run one command to its end: `{ exit, last }`, `last` being the last line
 * it printed — the one an error message can carry. Never throws; a command
 * that could not start is one that exited 127, and its `last` says why.
 */
export function runScript({ name, command, cwd, env, timeout }) {
	return new Promise((resolve) => {
		let printed = "";
		let settled = false;
		// A group of its own, so that stopping it stops what it started too: a
		// `sleep` left behind would hold the output open and the answer back.
		const child = spawn("/bin/bash", ["-lc", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
		for (const out of [child.stdout, child.stderr]) out.on("data", (d) => (printed += d));
		const stop = () => {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		};
		const timer = setTimeout(stop, timeout * 1000);
		const end = (exit, why) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (why) printed += `${printed && !printed.endsWith("\n") ? "\n" : ""}${why}\n`;
			const lines = printed.replace(/\s+$/, "").split("\n");
			try {
				const dir = join(cwd, ".pi", "runs");
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, `${name}.log`), `$ ${command}\n${lines.slice(-LOG_TAIL).join("\n")}\n(exit ${exit})\n`);
			} catch {
				// The log is a convenience; the answer is what is acted on.
			}
			resolve({ exit, last: lines.findLast((line) => line.trim()) ?? "" });
		};
		child.on("error", (err) => end(NOT_STARTED, err.message));
		child.on("close", (code, signal) => end(signal === "SIGKILL" ? TIMED_OUT : (code ?? NOT_STARTED), signal === "SIGKILL" ? `(stopped after ${timeout}s)` : null));
	});
}
