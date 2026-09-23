/**
 * The files a new workspace is given from the clone — what is kept beside
 * the code and out of git: an `.env`, a local config, a certificate. A
 * worktree has only what is committed, so without this every workspace
 * would begin by asking for them. Named in `.octave/config.toml` as
 * `copy = [".env*"]` (octaveConfig.js, that list being the default), the
 * way Conductor's "files to copy" and git's `.worktreeinclude` name them.
 *
 * A name is a path from the repository's root; only its last part may hold
 * `*`. What the workspace has already — a committed `.env.example` that the
 * pattern also matches — is left as it is: what is committed is the
 * branch's, and this is only for what is not. Pure but for the disk:
 * folders in, the copied paths out, tested on temp folders.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** The paths copied, as named from the root. Nothing thrown: a file that will not copy is one the setup will miss, and say so. */
export function copyInto(root, workdir, patterns) {
	const copied = [];
	for (const pattern of patterns) {
		for (const path of matching(root, pattern)) {
			const to = join(workdir, path);
			if (existsSync(to)) continue;
			try {
				mkdirSync(dirname(to), { recursive: true });
				copyFileSync(join(root, path), to);
				copied.push(path);
			} catch {
				// Left for the setup to miss.
			}
		}
	}
	return copied;
}

/** The files under `root` a pattern names — its folder as written, its last part with `*` for any run of characters. */
function matching(root, pattern) {
	const at = pattern.lastIndexOf("/");
	const dir = at === -1 ? "" : pattern.slice(0, at);
	const name = at === -1 ? pattern : pattern.slice(at + 1);
	if (!name || dir.includes("*")) return [];
	const shape = new RegExp(`^${name.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
	let entries;
	try {
		entries = readdirSync(join(root, dir));
	} catch {
		return [];
	}
	return entries
		.filter((entry) => shape.test(entry))
		.map((entry) => (dir ? `${dir}/${entry}` : entry))
		.filter((path) => {
			try {
				return statSync(join(root, path)).isFile();
			} catch {
				return false;
			}
		})
		.sort();
}
