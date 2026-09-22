/**
 * The repository's own commands, as `.octave/config.toml` holds them —
 * docs/spec-mode/spec-mode.md 6절 "저장소가 자기 명령을 파일로 말하고".
 *
 * Conductor's `[scripts]` shape, with a check of our own:
 *
 *   [scripts]
 *   copy    = [".env*"]           files not committed, copied from the clone into a new workspace (the default)
 *   setup   = "npm ci"            run once a workspace is made, after the copying
 *   archive = "…"                 run before a workspace is removed
 *   [scripts.run.dev]             what ▶ at the foot of the window starts
 *   command = "PORT=$OCTAVE_PORT npm run dev"
 *   default = true
 *   [[scripts.check]]             run after every task, before its commit
 *   name = "unit"
 *   command = "npm test"
 *   description = "…"             why, for the person reading the draft
 *   on = "task"                   task (default) | approve
 *   timeout = 600                 seconds; Claude Code's default
 *
 * Read by the shell (setup, run, archive) and by the spec extension
 * (checks), so it lives here, in plain JavaScript both can import, as
 * cities.js does. Read strictly: a value of the wrong shape is refused with
 * a word, not guessed at — the file is the person's, and a command that ran
 * from a misread line would be worse than one that did not run.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export const CONFIG_FILE = ".octave/config.toml";
export const DEFAULT_TIMEOUT = 600;
const EVENTS = ["task", "approve"];

/** @typedef {{ name: string, command: string, description: string, on: "task" | "approve", timeout: number }} Check */
/** @typedef {{ id: string, command: string, default: boolean }} Run */
/** @typedef {{ copy: string[], setup: string | null, archive: string | null, run: Run[], check: Check[] }} Config */

/** What is copied into a new workspace when the file says nothing: the secrets nearly every repository keeps beside its code and out of git. Conductor's default too. */
export const DEFAULT_COPY = Object.freeze([".env*"]);

/** Nothing to run: what a repository without the file, or with an empty one, comes to. */
export const EMPTY = Object.freeze({ copy: DEFAULT_COPY, setup: null, archive: null, run: [], check: [] });

const command = (value, where) => {
	if (value === undefined || value === "") return null;
	if (typeof value !== "string") throw new Error(`${where} must be a command, in quotes`);
	return value.trim() || null;
};

/**
 * The config a TOML text holds, or `{ error }` saying what is wrong with it.
 * Pure, so the reading is tested on text.
 * @returns {Config | { error: string }}
 */
export function configFrom(text) {
	let doc;
	try {
		doc = parse(text);
	} catch (err) {
		return { error: `${CONFIG_FILE}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
	}
	try {
		const scripts = doc.scripts;
		if (scripts === undefined) return { ...EMPTY };
		if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) throw new Error("[scripts] must be a table");
		const setup = command(scripts.setup, "scripts.setup");
		const archive = command(scripts.archive, "scripts.archive");
		let copy = [...DEFAULT_COPY];
		if (scripts.copy !== undefined) {
			if (!Array.isArray(scripts.copy) || scripts.copy.some((entry) => typeof entry !== "string")) throw new Error("scripts.copy must be a list of file names, in quotes");
			copy = scripts.copy.map((entry) => entry.trim()).filter(Boolean);
			for (const entry of copy) if (entry.startsWith("/") || entry.split("/").includes("..")) throw new Error(`scripts.copy: ${entry} is not inside the repository`);
		}
		const run = [];
		if (scripts.run !== undefined) {
			if (typeof scripts.run !== "object" || scripts.run === null || Array.isArray(scripts.run)) throw new Error("[scripts.run] must hold a table for each run, [scripts.run.<id>]");
			for (const [id, entry] of Object.entries(scripts.run)) {
				if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`[scripts.run.${id}] must be a table`);
				const cmd = command(entry.command, `scripts.run.${id}.command`);
				if (!cmd) throw new Error(`[scripts.run.${id}] needs a command`);
				if (entry.default !== undefined && typeof entry.default !== "boolean") throw new Error(`scripts.run.${id}.default must be true or false`);
				run.push({ id, command: cmd, default: entry.default === true });
			}
			if (run.length > 0 && !run.some((r) => r.default)) run[0].default = true;
		}
		const check = [];
		if (scripts.check !== undefined) {
			if (!Array.isArray(scripts.check)) throw new Error("[[scripts.check]] must be an array of tables — two brackets");
			scripts.check.forEach((entry, i) => {
				const where = `scripts.check[${i}]`;
				if (typeof entry !== "object" || entry === null) throw new Error(`${where} must be a table`);
				const cmd = command(entry.command, `${where}.command`);
				if (!cmd) throw new Error(`${where} needs a command`);
				const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : cmd;
				if (entry.description !== undefined && typeof entry.description !== "string") throw new Error(`${where}.description must be text`);
				const on = entry.on === undefined ? "task" : entry.on;
				if (!EVENTS.includes(on)) throw new Error(`${where}.on must be one of ${EVENTS.join(", ")}`);
				const timeout = entry.timeout === undefined ? DEFAULT_TIMEOUT : entry.timeout;
				if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) throw new Error(`${where}.timeout must be a number of seconds`);
				check.push({ name, command: cmd, description: entry.description ?? "", on, timeout });
			});
		}
		return { copy, setup, archive, run, check };
	} catch (err) {
		return { error: `${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/**
 * The repository's config, read from its folder: EMPTY where there is no
 * file, `{ error }` where the file is wrong. A folder is a workspace or the
 * clone; the file is the same in both, being committed.
 * @returns {Config | { error: string }}
 */
export function readConfig(root) {
	const file = join(root, CONFIG_FILE);
	if (!existsSync(file)) return { ...EMPTY };
	try {
		return configFrom(readFileSync(file, "utf8"));
	} catch (err) {
		return { error: `${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/** Whether what readConfig gave back is a config and not a complaint. */
export const isConfig = (value) => !("error" in value);
