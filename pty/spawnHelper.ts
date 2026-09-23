/**
 * node-pty's spawn-helper, made runnable before the first shell is spawned.
 *
 * node-pty forks a shell through a small binary it ships beside pty.node,
 * `prebuilds/<platform>-<arch>/spawn-helper`, whose execute bit its install
 * script sets. npm 11 does not run install scripts unless told to (`npm warn
 * install-scripts`), so after `npm ci` the file is there and 0644, and the
 * first spawn fails with `posix_spawnp failed` and nothing else. The bit is
 * set here, once, where it is needed — which is the one place that covers
 * a dev run, CI and the packaged app alike. Signing does not seal file
 * modes, so the packaged app's helper may be chmod'ed too.
 */
import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Where node-pty keeps the helper for this machine, or null where it ships none. */
export function spawnHelperPath(): string | null {
	const require = createRequire(import.meta.url);
	const pkg = dirname(require.resolve("node-pty/package.json"));
	const helper = join(pkg, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
	return existsSync(helper) ? helper : null;
}

/** True once the helper can be executed; false where there is none to fix. */
export function ensureSpawnHelper(): boolean {
	const helper = spawnHelperPath();
	if (helper === null) return false;
	try {
		accessSync(helper, constants.X_OK);
		return true;
	} catch {
		chmodSync(helper, 0o755);
		return true;
	}
}
