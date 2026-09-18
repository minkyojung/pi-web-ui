/**
 * The two search tools the agent leans on, fetched for the build.
 *
 * pi's grep and find run ripgrep and fd. On a machine without them pi
 * downloads both from GitHub the first time it searches — which is fine in a
 * terminal and not in an app handed to someone: it needs the network, it
 * needs GitHub reachable, and it is a download the person did not ask for.
 * VS Code ships ripgrep inside the app for the same reason; so does this.
 *
 * Versions and digests are pinned here. A build fetches each archive from
 * the tool's own GitHub release, checks it against the digest, and puts the
 * binary in build/bin/, which electron-builder.yml copies into the app's
 * Resources/bin and electron/main.js puts on the server's PATH. Fetched once
 * and kept; a digest that does not match is refused, not repaired.
 *
 *   node scripts/tools.mjs           fetch what is missing
 *   node scripts/tools.mjs --check   say whether build/bin is complete
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(root, "build", "bin");

/** Apple Silicon only, as the app is (electron-builder.yml). */
export const TOOLS = [
	{
		name: "rg",
		version: "15.2.0",
		url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-aarch64-apple-darwin.tar.gz",
		sha256: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
		inside: "ripgrep-15.2.0-aarch64-apple-darwin/rg",
		licence: { file: "ripgrep-15.2.0-aarch64-apple-darwin/LICENSE-MIT", spdx: "MIT OR Unlicense", project: "ripgrep" },
	},
	{
		name: "fd",
		version: "10.5.0",
		url: "https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-aarch64-apple-darwin.tar.gz",
		sha256: "b67e1836c468e42e411984b56e52fa7abec08c2bd22c867398e7cc134aac5e12",
		inside: "fd-v10.5.0-aarch64-apple-darwin/fd",
		licence: { file: "fd-v10.5.0-aarch64-apple-darwin/LICENSE-MIT", spdx: "MIT OR Apache-2.0", project: "fd" },
	},
];

/** The binary is there and says the pinned version. */
export function present(tool) {
	const file = join(BIN, tool.name);
	if (!existsSync(file)) return false;
	try {
		return execFileSync(file, ["--version"], { encoding: "utf8" }).includes(tool.version);
	} catch {
		return false;
	}
}

async function fetchTool(tool) {
	const res = await fetch(tool.url);
	if (!res.ok) throw new Error(`${tool.url}: ${res.status}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (digest !== tool.sha256) throw new Error(`${tool.name}: the archive's digest is ${digest}, not the ${tool.sha256} pinned here — not used`);
	const work = join(tmpdir(), `octave-tool-${tool.name}-${process.pid}`);
	mkdirSync(work, { recursive: true });
	const archive = join(work, "archive.tar.gz");
	writeFileSync(archive, bytes);
	execFileSync("tar", ["xzf", archive, "-C", work]);
	mkdirSync(BIN, { recursive: true });
	renameSync(join(work, tool.inside), join(BIN, tool.name));
	chmodSync(join(BIN, tool.name), 0o755);
	mkdirSync(join(BIN, "licences"), { recursive: true });
	writeFileSync(join(BIN, "licences", `${tool.name}.txt`), readFileSync(join(work, tool.licence.file), "utf8"));
	rmSync(work, { recursive: true, force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const missing = TOOLS.filter((t) => !present(t));
	if (process.argv.includes("--check")) {
		if (missing.length) {
			console.error(`build/bin is missing ${missing.map((t) => t.name).join(", ")} — run node scripts/tools.mjs`);
			process.exit(1);
		}
		console.log(`build/bin: ${TOOLS.map((t) => `${t.name} ${t.version}`).join(", ")}`);
	} else {
		for (const tool of missing) {
			process.stderr.write(`fetching ${tool.name} ${tool.version}… `);
			await fetchTool(tool);
			console.error("ok");
		}
		if (!missing.length) console.log(`build/bin already has ${TOOLS.map((t) => t.name).join(" and ")}`);
	}
}
