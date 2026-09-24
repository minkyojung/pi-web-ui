/**
 * Does a shell come up in a pty here? Run with `node scripts/pty-check.mjs`
 * (a dev run's node) or with Electron as node, which is what the packaged
 * app's server is:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/pty-check.mjs
 * Prints the runtime, whether the shell saw a tty, and its exit code.
 */
import { ensureSpawnHelper } from "../pty/spawnHelper.ts";
const pty = (await import("node-pty")).default;

console.log("spawn-helper:", ensureSpawnHelper() ? "executable" : "none shipped");
const shell = process.env.SHELL || "/bin/zsh";
const p = pty.spawn(shell, ["-l"], { cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
let out = "";
p.onData((d) => { out += d; });
p.onExit(({ exitCode }) => {
	const runtime = process.versions.electron ? `electron-as-node ${process.version}` : `node ${process.version}`;
	console.log(`runtime: ${runtime} | tty: ${/yes-tty/.test(out)} | exit ${exitCode}`);
	process.exit(/yes-tty/.test(out) && exitCode === 0 ? 0 : 1);
});
setTimeout(() => p.write("[ -t 1 ] && echo yes-tty; exit\r"), 800);
