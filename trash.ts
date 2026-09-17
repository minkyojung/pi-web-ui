/**
 * What deleting a note means.
 *
 * It means what deleting a file means on this machine: it goes to the trash
 * the person already has, the one the Finder opens, where it can be searched,
 * put back where it came from, and emptied on the schedule they chose. Not to
 * a folder only this app knows about.
 *
 * That follows from what this app is rather than from convenience. The folder
 * is the truth and the app is a window on it; an app that moves a file
 * somewhere only it can see is not a window, it is a place files hide. The
 * test that settles it: delete this app tomorrow and the notes are still
 * there, as promised — but everything ever deleted sits in a dot-folder
 * nobody will open again. In the machine's trash it is simply still there,
 * because it was never ours to keep. Obsidian's default is the same, for the
 * same reason.
 *
 * Only the shell can do it. The trash is not a directory you move a file into
 * — renaming one into ~/.Trash puts it there with its way home lost, since
 * what Put Back knows is kept by the Finder and not by the file — so it takes
 * the platform's own call, which in Electron is shell.trashItem and lives in
 * the main process. This process is not that one. It asks, over the channel a
 * parent and a child already have, and `process.send` being there at all is
 * the question "is there a shell?" already answered.
 *
 * Where there is no shell — a server started by hand, a page in a browser —
 * there is no machine trash to reach, and the note goes to the vault's own
 * `.pi/trash/` as it always did. Which of the two happened is told to the
 * tabs, because one of them can be undone from here and the other is undone
 * in the Finder.
 */
import { existsSync } from "node:fs";

import { resolveNote, trashNote } from "./vault.ts";

export type Deleted =
	/** To the machine's trash. Nothing here can bring it back; the Finder can. */
	| { ok: true; to: "system" }
	/** To `.pi/trash/notes/<trashed>`, which `restore_note` can undo. */
	| { ok: true; to: "vault"; trashed: string }
	| { ok: false; reason: "invalid" | "missing" };

/** Puts one file in the machine's trash, or says it could not. */
export type SystemTrash = (absolute: string) => Promise<boolean>;

/**
 * The machine's trash first, the vault's own as the fallback — including when
 * the shell is there but would not do it. A refusal is not a reason to leave
 * the note where it is: the person asked for it to go, and a note in
 * `.pi/trash/` is somewhere they can be told about.
 */
export async function deleteNote(root: string, path: string, system: SystemTrash | null): Promise<Deleted> {
	const full = resolveNote(root, path);
	if (!full) return { ok: false, reason: "invalid" };
	if (!existsSync(full)) return { ok: false, reason: "missing" };
	if (system && (await system(full))) return { ok: true, to: "system" };
	const moved = trashNote(root, path);
	return moved.ok ? { ok: true, to: "vault", trashed: moved.trashed } : { ok: false, reason: moved.reason };
}

/** The message the two sides of the bridge agree on. Changing it is changing electron/main.js too. */
const ASK = "trash";

/**
 * The shell's side of it, when there is a shell.
 *
 * `process.send` exists only because the parent opened an ipc channel for it
 * (see electron/main.js), so no environment variable is needed to say which
 * kind of run this is. An answer that never comes is a no after `timeoutMs`:
 * the person is waiting on a keystroke, and the vault's trash is right there.
 */
export function shellTrash(timeoutMs = 5000): SystemTrash | null {
	const send = process.send?.bind(process);
	if (!send) return null;
	const waiting = new Map<number, (ok: boolean) => void>();
	let next = 1;
	process.on("message", (message: unknown) => {
		const m = message as { ask?: string; id?: number; ok?: boolean };
		if (m?.ask !== ASK || typeof m.id !== "number") return;
		waiting.get(m.id)?.(m.ok === true);
		waiting.delete(m.id);
	});
	return (absolute) =>
		new Promise((resolve) => {
			const id = next++;
			const timer = setTimeout(() => {
				waiting.delete(id);
				resolve(false);
			}, timeoutMs);
			waiting.set(id, (ok) => {
				clearTimeout(timer);
				resolve(ok);
			});
			send({ ask: ASK, id, path: absolute });
		});
}
