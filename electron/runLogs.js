/**
 * The logs the repository's commands left in a workspace — `.pi/runs/`,
 * where setup, archive and the run write theirs (scripts.js, runs.js) —
 * for the menu at the foot of the window to offer, each with how it ended
 * as the log's last line says it: `(exit N)`, or nothing while it is still
 * being written. The tasks' checks write a folder deeper, under the task's
 * number (spec.ts); those are the results list's to offer, not this menu's.
 * Pure: a folder in, a list out.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Only the tail is read for the exit: a run's log can be long. */
const TAIL_BYTES = 256;

/** `{ name, path, exit, modified }` per log, newest first; `path` as the tab opens it, `exit` null while still open. */
export function runLogsIn(workdir) {
	const dir = join(workdir, ".pi", "runs");
	let names;
	try {
		names = readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
			.map((entry) => entry.name);
	} catch {
		return [];
	}
	const logs = [];
	for (const file of names) {
		try {
			const full = join(dir, file);
			const { size, mtimeMs } = statSync(full);
			const tail = readFileSync(full).subarray(Math.max(0, size - TAIL_BYTES)).toString("utf8");
			const said = tail.match(/\(exit (\d+)\)\n?$/);
			logs.push({ name: file.slice(0, -".log".length), path: `.pi/runs/${file}`, exit: said ? Number(said[1]) : null, modified: mtimeMs });
		} catch {
			// Gone between the listing and the reading: not a log to offer.
		}
	}
	return logs.sort((a, b) => b.modified - a.modified);
}
