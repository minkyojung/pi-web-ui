/**
 * The wall pi's shell runs behind: it cannot write anything under `.pi/`,
 * because the operating system refuses it.
 *
 * `bash` names nothing — there is no parse of a shell line that says which
 * files it will write — so a folder the shell must not touch is kept from it
 * by the kernel rather than by reading the command. guard.ts refuses a bash
 * call that mentions the folder, which catches the plain ones; this catches
 * the rest, and the paths that only resolve there.
 *
 * It used to deny writing `*.md` as well, so that every note went through the
 * app's own pair and was recorded as the agent's. That record is given up
 * (docs/spec-mode) and the denial went with it: a note is a file like any
 * other now, and the shell writes it. The hole this profile used to punch for
 * the agent's specs went too — with no rule over markdown there is nothing to
 * make an exception to.
 *
 * Done by rewriting the command in `tool_call`, which pi documents as the way
 * to patch a tool's arguments before it runs: the command becomes
 * `sandbox-exec -f <profile> /bin/bash -c <command>`. pi's own shell still
 * spawns it and still kills it on timeout — `exec` keeps the pid.
 *
 * `sandbox-exec` is what Chrome and Bazel run under; Apple calls it deprecated
 * and ships it in every release. Where it is not there — another platform —
 * there is no wall, and a note the shell writes is found the way any write
 * from outside is found, and called outside: the cheap wrong answer.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { APP_DIR_NAME } from "./documentKinds.ts";
import { APP_DIR } from "./settings.ts";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** Whether this machine can put up the wall. */
export const hasWall = (): boolean => process.platform === "darwin" && existsSync(SANDBOX_EXEC);

/** A path as a Seatbelt string literal wants it. */
const inString = (path: string) => path.replace(/[\\"]/g, "\\$&");

/**
 * The profile for one folder. `vault` is the folder's real path — the one the
 * kernel sees, which is what the sandbox matches against; a symlinked vault
 * given by its link name would leave every note writable.
 */
export function profileFor(vault: string): string {
	return [
		"(version 1)",
		"(allow default)",
		// Whatever path leads there: the kernel matches the real one, which is
		// why `vault` is the folder's real path and not a link to it.
		`(deny file-write* (subpath "${inString(join(vault, APP_DIR_NAME))}"))`,
		"",
	].join("\n");
}

/** Where the profile for a folder lives: in the app's own directory, named by the folder, not in the folder. */
export const profilePath = (vault: string): string => join(APP_DIR, "walls", `${createHash("sha256").update(vault).digest("hex").slice(0, 16)}.sb`);

/** Write the profile for a folder and say where it is. Written every time: it is a few lines, and the folder may have moved. */
export function writeProfile(vault: string): string {
	const file = profilePath(vault);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, profileFor(vault));
	return file;
}

/** A string as one shell word: single-quoted, with each quote inside stepped out of and back in. */
export const quoted = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The command, behind the wall. */
export const walled = (command: string, profile: string): string => `exec ${SANDBOX_EXEC} -f ${quoted(profile)} /bin/bash -c ${quoted(command)}`;

export const wall = (root: string) => (pi: ExtensionAPI) => {
	if (!hasWall()) return;
	const profile = writeProfile(realpathSync.native(root));
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const input = event.input as { command?: unknown };
		if (typeof input.command !== "string") return;
		input.command = walled(input.command, profile);
	});
};
