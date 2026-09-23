/**
 * One terminal: a login shell in a pty, and the one socket that is its
 * screen for now.
 *
 * What the shell prints goes to the socket as it is, in binary frames —
 * bytes, not lines and not text, so a Korean character split across two
 * reads arrives whole to the terminal drawing it, which keeps the UTF-8
 * state. What the socket sends in binary frames is typed and goes to the
 * shell; what it sends in text frames is JSON about the terminal:
 * `resize`, `ack` (bytes drawn — flow.ts), `close`. The socket hears `exit`
 * when the shell ends.
 *
 * The pty outlives the socket: a tab that reloads, or a window that moves
 * to another workspace and back, attaches again to the same shell. One
 * socket at a time — a second attaching takes the terminal from the first,
 * which is closed and told so.
 */
import { existsSync } from "node:fs";
import { spawn as spawnPty } from "node-pty";
import type { WebSocket } from "ws";
import { shellEnvFor } from "./env.ts";
import { acked, idle, sent, type Flow } from "./flow.ts";
import { ensureSpawnHelper } from "./spawnHelper.ts";

export type Terminal = {
	attach(ws: WebSocket): void;
	kill(): void;
	readonly exited: boolean;
};

/** After SIGHUP, how long a shell has to go before it is killed. */
const GRACE_MS = 2000;

/** The shell to run: the person's login shell, or what there is. */
function shellOf(env: NodeJS.ProcessEnv): string {
	for (const candidate of [env.SHELL, "/bin/zsh", "/bin/bash"]) if (candidate && existsSync(candidate)) return candidate;
	return "/bin/sh";
}

export function createTerminal({ cwd, env, onExit }: { cwd: string; env: NodeJS.ProcessEnv; onExit: (code: number) => void }): Terminal {
	ensureSpawnHelper();
	// encoding null: the pty's bytes as they come, not decoded to strings.
	const pty = spawnPty(shellOf(env), ["-l"], { cwd, env: shellEnvFor(env), cols: 80, rows: 24, name: "xterm-256color", encoding: null });
	let ws: WebSocket | null = null;
	let flow: Flow = idle;
	let exited = false;

	const detach = () => {
		// Nobody drawing: nothing to wait for, so a shell paused for the last
		// screen is read again.
		if (flow.paused) pty.resume();
		flow = idle;
		ws = null;
	};

	pty.onData((chunk) => {
		const bytes = chunk as unknown as Buffer;
		if (!ws || ws.readyState !== ws.OPEN) return;
		ws.send(bytes, { binary: true });
		const s = sent(flow, bytes.length);
		flow = s.flow;
		if (s.pause) pty.pause();
	});
	pty.onExit(({ exitCode }) => {
		exited = true;
		if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "exit", code: exitCode }));
		onExit(exitCode);
	});

	function attach(socket: WebSocket): void {
		if (ws && ws !== socket) ws.close(1000, "another tab took the terminal");
		detach();
		ws = socket;
		socket.on("message", (data, isBinary) => {
			if (ws !== socket) return;
			if (isBinary) {
				pty.write(data as Buffer);
				return;
			}
			let msg: { type?: unknown; cols?: unknown; rows?: unknown; bytes?: unknown };
			try {
				msg = JSON.parse(data.toString());
			} catch {
				return;
			}
			if (msg.type === "resize" && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
				const cols = Math.min(500, Math.max(2, msg.cols as number));
				const rows = Math.min(300, Math.max(1, msg.rows as number));
				if (!exited) pty.resize(cols, rows);
			} else if (msg.type === "ack" && typeof msg.bytes === "number" && msg.bytes >= 0) {
				const a = acked(flow, msg.bytes);
				flow = a.flow;
				if (a.resume) pty.resume();
			} else if (msg.type === "close") {
				kill();
			}
		});
		socket.on("close", () => {
			if (ws === socket) detach();
		});
		// ws emits 'error' for a malformed frame, and Node throws on an 'error'
		// event nobody listens for.
		socket.on("error", () => {});
	}

	const signal = (sig: NodeJS.Signals) => {
		// The shell is its pty's session leader, so its process group is the
		// shell and everything it started.
		try {
			process.kill(-pty.pid, sig);
		} catch {
			pty.kill(sig);
		}
	};

	function kill(): void {
		if (exited) return;
		signal("SIGHUP");
		setTimeout(() => {
			if (!exited) signal("SIGKILL");
		}, GRACE_MS).unref();
	}

	return {
		attach,
		kill,
		get exited() {
			return exited;
		},
	};
}
