/**
 * Putting a file on disk so that a reader never finds half of one.
 *
 * Writing is not one step. A process that dies in the middle of it — a crash,
 * a kill, a quit that did not wait — leaves the bytes that made it and nothing
 * after, and what was there before is already gone. Renaming is one step: the
 * file system moves a name onto a file as a single operation. So the new text
 * is written beside the old file under a name nobody reads, and the name is
 * moved onto it once all of it is there. A reader gets the old file or the new
 * one, never the seam.
 *
 * This is what `writeNote` has always done, and what every editor does with a
 * document. The sidecars beside the notes did not: `.pi/properties.json` and
 * the app's settings were written over themselves, and a reader that found
 * half a JSON file has nowhere to go but the defaults — silently, since a
 * half-written file is not a readable one. The link index can be rebuilt from
 * the notes, so losing it costs a pass over the folder; the other two are
 * choices a person made and nothing else knows them.
 *
 * What it does not do is fsync. This makes a torn file impossible, which is
 * the failure that has a cause here — a process going away mid-write. Against
 * losing power between the write and the rename it makes no promise, which is
 * the trade git makes for its index and editors make for your document.
 *
 * The temporary name carries the process id, so two writers never take each
 * other's unfinished file.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeAtomic(file: string, text: string): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, text);
	renameSync(tmp, file);
}
