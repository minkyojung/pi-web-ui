/**
 * The pi extension that writes pi's edits into a note's history.
 *
 * pi reaches the vault with its own `edit` and `write`; nothing here changes
 * that. `tool_call` fires before either runs, which is when the note can still
 * be read as it was, and `tool_result` fires after, saying whether it worked.
 * The two together are a before and an after, which is all history.ts asks
 * for. A write pi makes through `bash` is not seen here; it is caught later as
 * "outside", when the note is next opened and the disk disagrees with the log.
 *
 * Runs inside pi's extension runner, like the reader's set_gist did, so it is
 * bound per session and retired with it. Only paths that are notes are kept:
 * pi editing a source file is not the vault's business.
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { type Change, record } from "./history.ts";
import { resolveNote } from "./vault.ts";

/**
 * Tell the server a note was written: the version it was written over (its
 * mtime before, or null if it did not exist) and the changes, so tabs on that
 * version can apply them where they fall.
 */
export type OnNoteWritten = (path: string, base: number | null, changes: Change[]) => void;

export const recorder = (root: string, onWritten: OnNoteWritten) => (pi: ExtensionAPI) => {
	/** What each in-flight call is about to change, by call id. */
	const before = new Map<string, { path: string; text: string; modified: number | null }>();

	// pi's tools take a path as given, relative or absolute; the vault knows
	// notes by their path from the root.
	const notePath = (given: string): string | null => {
		const path = isAbsolute(given) ? relative(root, given) : given;
		return resolveNote(root, path) ? path : null;
	};

	const readOrEmpty = (path: string): string => {
		try {
			return readFileSync(resolveNote(root, path)!, "utf8");
		} catch {
			return ""; // Not there yet: `write` creating it.
		}
	};
	const modifiedOrNull = (path: string): number | null => {
		try {
			return statSync(resolveNote(root, path)!).mtimeMs;
		} catch {
			return null;
		}
	};

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) return;
		const path = notePath(event.input.path);
		if (path) before.set(event.toolCallId, { path, text: readOrEmpty(path), modified: modifiedOrNull(path) });
	});

	pi.on("tool_result", async (event, ctx) => {
		const had = before.get(event.toolCallId);
		if (!had) return;
		before.delete(event.toolCallId);
		if (event.isError) return;
		const after = readOrEmpty(had.path);
		const changes = record(root, had.path, had.text, after, {
			author: "pi",
			at: Date.now(),
			sessionId: ctx.sessionManager.getSessionId(),
			// The assistant message that made the call: pi waits for the session
			// to catch up to it before tool_call runs.
			entryId: ctx.sessionManager.getLeafId() ?? undefined,
		});
		onWritten(had.path, had.modified, changes);
	});
};
