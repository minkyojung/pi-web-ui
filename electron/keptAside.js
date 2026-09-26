/**
 * What a workspace was given in its message box, kept while it is archived.
 *
 * Archiving gives the folder back (main.js archiveWorkspace), and what the
 * branch does not hold goes with it — which, for the files dropped on the
 * message box, is all of them: they are kept out of git on purpose
 * (attach.ts saveMessageAttachment). So they are moved aside first, to
 * `~/octave/archived/<repository>/<workspace>/attachments`, beside where the
 * workspaces are kept as Conductor keeps `archived-contexts` beside its
 * `workspaces`, and moved back when the workspace is restored.
 *
 * Moved a folder at a time — each attachment has one of its own — so a move
 * that finds some already there, from a move before that stopped halfway,
 * adds to them rather than failing on them. A move across disks is a copy
 * and then a removal. Pure: paths in, files moved.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Where a message box's files are kept in a workspace, as attach.ts has it. */
export const MESSAGE_ATTACHMENTS = join(".octave", "attachments");

/** Where a workspace's are kept while it is archived: under `archived/`, as the workspace is under `workspaces/`. */
export const asideOf = (home, workspace) => join(home, "archived", basename(dirname(workspace)), basename(workspace), "attachments");

/** Every folder in `from` into `to`, and `from` gone once it is empty. Nothing to move is nothing done. */
function moveEach(from, to) {
	if (!existsSync(from)) return;
	mkdirSync(to, { recursive: true });
	for (const name of readdirSync(from)) {
		const there = join(to, name);
		// Already there from a move that stopped: the one left behind is the same folder.
		if (existsSync(there)) {
			rmSync(join(from, name), { recursive: true, force: true });
			continue;
		}
		try {
			renameSync(join(from, name), there);
		} catch (err) {
			if (err.code !== "EXDEV") throw err;
			cpSync(join(from, name), there, { recursive: true });
			rmSync(join(from, name), { recursive: true, force: true });
		}
	}
	rmSync(from, { recursive: true, force: true });
}

/** Before the folder goes: its message box's files to where they wait. */
export const setAside = (workspace, aside) => moveEach(join(workspace, MESSAGE_ATTACHMENTS), aside);

/** After the folder is made again: back where the messages that named them say they are, and nothing left waiting. */
export function putBack(aside, workspace) {
	moveEach(aside, join(workspace, MESSAGE_ATTACHMENTS));
	// The workspace's folder under archived/, empty now unless something else was put there.
	if (existsSync(dirname(aside)) && readdirSync(dirname(aside)).length === 0) rmSync(dirname(aside), { recursive: true });
}
