/**
 * Notice a note changing on disk, whoever changed it.
 *
 * The writes that pass through the app are already known as they happen.
 * This is for the ones that do not — pi's `bash`, another editor — so that
 * they too are recorded and shown as they happen rather than when the note
 * is next opened. The OS reports the folder; this narrows it to notes, folds
 * the burst a single save produces into one report, and leaves telling an
 * echo of the app's own write from a real change to the caller, which can
 * compare the disk to what it last knew.
 *
 * Node's recursive fs.watch, which macOS and Linux both back natively now,
 * rather than a watcher package: the folder is one person's notes, not a
 * monorepo, and one fewer dependency is one fewer thing to keep working.
 */
import { type FSWatcher, watch } from "node:fs";
import { sep } from "node:path";
import { resolveNote } from "./vault.ts";

/** How long after the last event on a path before it is reported. A save is several events. */
const SETTLE_MS = 80;

export type OnNoteEvent = (path: string) => void;

export function watchNotes(root: string, onEvent: OnNoteEvent, settleMs = SETTLE_MS): () => void {
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let watcher: FSWatcher | null = null;
	try {
		watcher = watch(root, { recursive: true }, (_event, filename) => {
			if (!filename) return;
			const path = String(filename).split(sep).join("/");
			// Not a note — a dotfolder, the history itself, a non-markdown file — is not news.
			if (!resolveNote(root, path)) return;
			const pending = timers.get(path);
			if (pending) clearTimeout(pending);
			timers.set(
				path,
				setTimeout(() => {
					timers.delete(path);
					onEvent(path);
				}, settleMs),
			);
		});
		watcher.on("error", () => {
			// Watching stopping is a loss of promptness, not of data: the next open
			// still reconciles. Nothing to do but not crash.
		});
	} catch {
		// Same: no watcher, no crash.
	}
	return () => {
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
		watcher?.close();
	};
}
