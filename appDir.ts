/**
 * The app's folder beside the notes, and what git should make of it.
 *
 * A folder of notes is often a git repository already — Obsidian vaults
 * commonly are — and the moment the app makes `.pi/`, git asks about it.
 * Left unanswered, the person answers by accident either way: commit it, and
 * every autosave dirties a log and a cache; ignore it, and a clone on the next
 * machine has no idea who wrote what, which is the one thing in the vault the
 * notes cannot give back. So the app answers for its own folder, the way a
 * tool that makes a `node_modules` or a `.DS_Store` is expected to know what
 * it is.
 *
 * The answer: keep what cannot be rebuilt, ignore what can. The history is
 * the record; `properties.json` is what the person chose; both travel with
 * the notes. The snapshot beside each log and `links.json` are caches, rebuilt
 * from what they sit beside, and `trash/` is this machine's — a deleted note
 * is not something to push. Written once, and never over: a person who has
 * written their own has answered already.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR_NAME } from "./guard.ts";

export const GITIGNORE = [
	"# Written by Octave, once; edit freely. What is not listed here travels with",
	"# the notes: history/ is who wrote which words, and cannot be rebuilt from them.",
	"*.snapshot.json",
	"links.json",
	"trash/",
	"",
].join("\n");

/** Make sure `.pi/` is there and has said what git should keep of it. True when the file was written now. */
export function claimAppDir(root: string): boolean {
	const dir = join(root, APP_DIR_NAME);
	const file = join(dir, ".gitignore");
	if (existsSync(file)) return false;
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, GITIGNORE);
	return true;
}
