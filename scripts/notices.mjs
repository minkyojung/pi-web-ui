/**
 * The licences of everything that ships inside the app, in one file.
 *
 * Octave is AGPL-3.0, and everything it is built on is MIT, ISC, BSD or
 * Apache — permissive, but every one of them asks the same thing in return:
 * carry the notice. The server ships with its node_modules beside it and the
 * client ships with its libraries bundled in, so both trees are walked here
 * and their LICENSE files copied out whole, package by package, into
 * THIRD_PARTY_NOTICES.md, which electron-builder puts in the app.
 *
 * Which packages: the production dependency tree entire, since that is what
 * is on disk in the app; and of the devDependencies, those the browser bundle
 * is made of — everything but the tools that build it, named below, and their
 * trees too. A tool that only ran on the build machine is not distributed and
 * owes nobody a notice. Too many is a longer file; too few is a breach.
 *
 * A package that names a licence in its package.json but carries no text —
 * pi's own packages do this — is listed with the name and its author, which is
 * what the licence file would have said. What is refused is a licence that
 * is not on the list below: one that is not permissive would change what
 * Octave may be licensed as, and one nobody has read is not known to be.
 *
 *   node scripts/notices.mjs           writes THIRD_PARTY_NOTICES.md
 *   node scripts/notices.mjs --check   exits non-zero on a licence not on the list
 */
import { TOOLS as TOOLS_CARRIED } from "./tools.mjs";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** devDependencies that only build the app and never ship in it. */
const TOOLS = new Set([
	"concurrently", "electron", "electron-builder", "esbuild", "tailwindcss", "@tailwindcss/vite",
	"@tailwindcss/typography", "tsx", "typescript", "vite", "@vitejs/plugin-react",
]);

const roots = [
	...Object.keys(pkg.dependencies ?? {}),
	...Object.keys(pkg.devDependencies ?? {}).filter((n) => !TOOLS.has(n) && !n.startsWith("@types/")),
];

/** The directory a package resolves to from `from`, following node's own rules. */
function dirOf(name, from) {
	const require = createRequire(join(from, "package.json"));
	try {
		return dirname(require.resolve(`${name}/package.json`));
	} catch {
		// Packages with an `exports` map that hides package.json: walk up node_modules by hand.
		let dir = from;
		while (dir !== dirname(dir)) {
			const candidate = join(dir, "node_modules", name);
			if (existsSync(join(candidate, "package.json"))) return candidate;
			dir = dirname(dir);
		}
		return null;
	}
}

/** Permissive licences, which Octave's AGPL-3.0 may be built on. */
const ALLOWED = /^(MIT|ISC|0BSD|BSD-[23]-Clause|Apache-2\.0|BlueOak-1\.0\.0|MPL-2\.0|CC0-1\.0|Unlicense|Python-2\.0|WTFPL)$/;
/** An SPDX expression is fine if any one alternative is. */
const allowed = (license) => license.replace(/[()]/g, "").split(/\s+OR\s+/).some((l) => ALLOWED.test(l.trim()));

const seen = new Map(); // dir -> { name, version, license, author, text }
const refused = [];

function visit(name, from) {
	const dir = dirOf(name, from);
	if (!dir || seen.has(dir)) return;
	const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
	const text = file ? readFileSync(join(dir, file), "utf8").trim() : null;
	const license = typeof meta.license === "string" ? meta.license : JSON.stringify(meta.license ?? meta.licenses ?? "unknown");
	const author = typeof meta.author === "string" ? meta.author : meta.author?.name;
	seen.set(dir, { name: meta.name, version: meta.version, license, author, text });
	if (!allowed(license)) refused.push(`${meta.name}@${meta.version} (${license})`);
	for (const dep of Object.keys(meta.dependencies ?? {})) visit(dep, dir);
	// Optional dependencies ship when installed; on this machine, they are.
	for (const dep of Object.keys(meta.optionalDependencies ?? {})) visit(dep, dir);
}

for (const name of roots) visit(name, root);

// The two search tools carried in Resources/bin are not packages; their
// licences come from the archives scripts/tools.mjs unpacked.
for (const tool of TOOLS_CARRIED) {
	const text = readFileSync(join(root, "build", "bin", "licences", `${tool.name}.txt`), "utf8");
	seen.set(`tool:${tool.name}`, { name: tool.licence.project, version: tool.version, license: tool.licence.spdx, author: null, text });
}
const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const out = [
	"# Third-party notices",
	"",
	`Octave is licensed under the GNU Affero General Public License v3.0 (see LICENSE).`,
	`It is built on the ${entries.length} packages below, distributed with it under their own licences, reproduced here as they ask.`,
	"",
	...entries.flatMap((e) => [
		`## ${e.name} ${e.version} — ${e.license}`,
		"",
		"```",
		e.text ?? `Licensed ${e.license}${e.author ? `. Copyright ${e.author}` : ""}. (The package carries no licence text; this is what its package.json says.)`,
		"```",
		"",
	]),
].join("\n");

if (refused.length) {
	console.error(`licence not on the list for ${refused.length} package(s):\n  ${refused.join("\n  ")}`);
	process.exit(1);
}
if (process.argv.includes("--check")) {
	console.log(`${entries.length} packages, every licence on the list`);
} else {
	writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), out);
	console.log(`THIRD_PARTY_NOTICES.md: ${entries.length} packages`);
}
