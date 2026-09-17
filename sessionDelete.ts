/**
 * Deleting a session file, the way pi's own picker does it: the `trash` CLI
 * first, so the file can be got back from the system's bin, then a plain
 * unlink when there is no such command. What it reports is which of the
 * two it was, since one is reversible and the other is not.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

export async function deleteSessionFile(sessionPath: string): Promise<{ method: "trash" | "unlink" }> {
	const args = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
	const trashed = spawnSync("trash", args, { encoding: "utf-8" });
	if (trashed.status === 0 || !existsSync(sessionPath)) return { method: "trash" };
	await unlink(sessionPath);
	return { method: "unlink" };
}
