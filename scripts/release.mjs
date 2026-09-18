/**
 * Cutting a release: the changelog is closed, the version is bumped, the tag
 * is made. Nothing is pushed — the last line says how.
 *
 * Two things stand in the way on purpose. The [Unreleased] section must have
 * something in it, since a release with no notes is one nobody can be told
 * about — and the updater shows these notes. And before that section is
 * closed, the commits since the last tag are read against it: `claude -p`
 * is asked which changes a person could notice are in the commits and not
 * in the notes, and what it finds is shown, to be added or waved through.
 * Keep a Changelog's rule — machines draft, a person curates — is why it
 * asks rather than writes.
 *
 * The version is the argument, and the checks are what release.yml repeats
 * on the tag: package.json agrees, CHANGELOG.md has a section for it.
 *
 *   node scripts/release.mjs 0.0.2           check, close, bump, commit, tag
 *   node scripts/release.mjs 0.0.2 --yes     without the prompt
 *   node scripts/release.mjs 0.0.2 --no-ai   without asking claude
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

export { REPO, cut, sectionFor, unreleased } from "../changelog.mjs";
import { cut, sectionFor, unreleased } from "../changelog.mjs";

/** The question put to claude, and its answer read as a list — or null when it could not be asked. */
export function askForOmissions(commits, notes) {
	const prompt = [
		"Below are the commits since the last release of a desktop app, then the CHANGELOG entries drafted for it.",
		"List any change a person USING the app could notice — something they see, a key that does something new, something that happens to their files — that the commits contain and the entries do not.",
		"One line per omission, written for that person, no code names. If nothing is missing, answer exactly: NONE",
		"", "=== COMMITS ===", commits, "", "=== CHANGELOG ENTRIES ===", notes,
	].join("\n");
	const run = spawnSync("claude", ["-p", "--output-format", "text"], { input: prompt, encoding: "utf8" });
	if (run.error || run.status !== 0) return null;
	const answer = run.stdout.trim();
	return /^NONE\b/i.test(answer) ? [] : answer.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

async function main() {
	const [version, ...flags] = process.argv.slice(2);
	if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
		console.error("usage: node scripts/release.mjs <x.y.z> [--yes] [--no-ai]");
		process.exit(2);
	}
	if (git("status", "--porcelain")) {
		console.error("the working tree is not clean; commit or set aside what is there first");
		process.exit(1);
	}
	const changelog = readFileSync("CHANGELOG.md", "utf8");
	const notes = unreleased(changelog);
	if (!notes) {
		console.error("[Unreleased] is empty: a release with nothing to say is not one. Add the lines, then again.");
		process.exit(1);
	}
	const previous = git("tag", "--list", "v*", "--sort=-v:refname").split("\n").filter(Boolean)[0] || null;
	if (previous === `v${version}`) {
		console.error(`${previous} already exists`);
		process.exit(1);
	}

	if (!flags.includes("--no-ai")) {
		const range = previous ? `${previous}..HEAD` : "HEAD";
		const commits = git("log", range, "--format=%s%n%b---");
		process.stderr.write("asking claude what the notes leave out… ");
		const missing = askForOmissions(commits, notes);
		if (missing === null) console.error("claude could not be asked; skipping.");
		else if (missing.length === 0) console.error("nothing.");
		else {
			console.error(`\nThe commits contain, and [Unreleased] does not:\n${missing.map((m) => `  - ${m}`).join("\n")}\n`);
			if (!flags.includes("--yes")) {
				const rl = createInterface({ input: process.stdin, output: process.stderr });
				const a = await rl.question("Release anyway? [y/N] ");
				rl.close();
				if (!/^y/i.test(a)) process.exit(1);
			}
		}
	}

	// The day here, not the day in Greenwich: 0.0.2 was cut on a Friday morning
	// in Seoul and the changelog said Thursday.
	const now = new Date();
	const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	writeFileSync("CHANGELOG.md", cut(changelog, version, date, previous));
	// The first release is the version package.json was given when the app was
	// named, and npm refuses a version that is not a change unless told.
	execFileSync("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], { stdio: "ignore" });
	git("add", "CHANGELOG.md", "package.json", "package-lock.json");
	git("commit", "-q", "-m", `Octave ${version}`);
	git("tag", "-a", `v${version}`, "-m", `Octave ${version}\n\n${notes}`);
	console.log(`Octave ${version}: committed and tagged. To release:\n  git push && git push origin v${version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
