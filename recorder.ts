/**
 * Whose the words are, when a note was written by no door of ours.
 *
 * A note pi means to write goes through note_edit or note_write, which know
 * what they changed and say so — see noteEdit.ts — and `edit` and `write` are
 * refused on one before they run, in guard.ts. What is left is `bash`, which
 * names nothing: a command that writes a note cannot be told from one that
 * reads it, and there is no parse of a shell line that settles it. So a write
 * made there is found the way any write from outside the app is found — the
 * disk stops agreeing with the log — and what this file adds is the answer to
 * whose it was.
 *
 * The log is append-only and has no line that changes an earlier line's
 * author, so that answer has to be right at the moment the line is written.
 * The watcher is the only thing that knows *when* a note changed, so it is
 * left to log as promptly as it always did and given a `claim` to ask with
 * instead: while a shell call is in flight, a note whose file is newer than
 * the call started is pi's, and carries the session and the message it came
 * from. Waiting for the call to end instead would be worse than the bug —
 * `npm run dev` runs for minutes, and every save the person made meanwhile
 * would come back marked as pi's words in their own editor.
 *
 * A claim is bounded: a note that changes in the fifth minute of a dev server
 * is the person, not the command, so after CLAIM_MS the answer is "outside"
 * again — the cheap wrong answer rather than the expensive one.
 *
 * Runs inside pi's extension runner, like the reader's set_gist did, so it is
 * bound per session and retired with it. Only notes are looked at: pi running a
 * build or a test is not the vault's business.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Change, type Origin, readHistory, reconcile } from "./history.ts";
import { LIMIT, listNotes, readNote } from "./vault.ts";

/**
 * Tell the server a note was written: the version it was written over (its
 * mtime before, or null if it did not exist) and the changes, so tabs on that
 * version can apply them where they fall.
 */
export type OnNoteWritten = (path: string, base: number | null, changes: Change[]) => void;

/**
 * Whose a change to a note is, asked by whoever is about to log it. Null is
 * "not pi's" — the caller keeps its own answer, which is "outside".
 */
export type Claim = (path: string, mtimeMs: number) => Origin | null;

/** The tools that write without saying what they write. */
const SHELL = new Set(["bash", "powershell"]);

/** How long after a shell call starts a note that changed can still be its doing. */
const CLAIM_MS = 10_000;

/** A shell call in flight, and the vault as it stood when it began. */
type Shell = {
	startedAt: number;
	sessionId: string;
	entryId?: string;
	/** Every note's mtime before the call. */
	notes: Map<string, number>;
	/** The listing hit its cap, so "absent" no longer means "not there". */
	capped: boolean;
};

export function recorder(root: string, onWritten: OnNoteWritten): { factory: (pi: ExtensionAPI) => void; claim: Claim } {
	/** Each in-flight shell call, by call id. More than one: tools run in parallel. */
	const shells = new Map<string, Shell>();

	const snapshot = (): Pick<Shell, "notes" | "capped"> => {
		const found = listNotes(root);
		return { notes: new Map(found.map((file) => [file.path, file.modified])), capped: found.length >= LIMIT };
	};

	/**
	 * Whose a note's change is, during a given shell call.
	 *
	 * pi may only be named over a difference measured from a state the app
	 * knew. A note with a log has one. A note without a log is seeded whole by
	 * reconcile, so naming pi there would hand pi every word the person ever
	 * wrote in it — unless the note was not there before the call at all, in
	 * which case pi did write every word of it. A truncated listing cannot
	 * tell the two apart, and says so.
	 */
	const authorOf = (path: string, shell: Shell, at: number): Origin => {
		const logged = readHistory(root, path).length > 0;
		const there = shell.notes.has(path);
		if (logged || (!there && !shell.capped)) return { author: "pi", at, sessionId: shell.sessionId, entryId: shell.entryId };
		return { author: "outside", at };
	};

	const claimAt = (path: string, mtimeMs: number, at: number): Origin | null => {
		for (const shell of shells.values()) {
			// Older than the call: whatever it is, the call did not do it.
			if (mtimeMs < shell.startedAt) continue;
			if (at - shell.startedAt > CLAIM_MS) continue;
			const origin = authorOf(path, shell, at);
			if (origin.author === "pi") return origin;
		}
		return null;
	};

	const claim: Claim = (path, mtimeMs) => claimAt(path, mtimeMs, Date.now());

	/**
	 * After a shell call: the notes it left different from how it found them.
	 *
	 * A net rather than the path itself — the watcher has usually logged the
	 * write already, claimed as pi's, and then the log agrees with the disk
	 * and there is nothing here to append. This catches what the watcher
	 * missed: an event it could not start, one it coalesced away, and a write
	 * that landed inside its settling window.
	 *
	 * It asks the same question the watcher asks, of the same calls, so that a
	 * command which ran too long to be told from the person typing does not
	 * get handed everything they wrote by coming in through the net instead.
	 * The log still catches up; only the name on it changes.
	 */
	const settle = (shell: Shell): void => {
		const at = Date.now();
		for (const file of listNotes(root)) {
			if (shell.notes.get(file.path) === file.modified) continue;
			const found = readNote(root, file.path);
			if (!found) continue; // Gone between the listing and the read; the watcher has it.
			const origin = claimAt(file.path, file.modified, at) ?? { author: "outside" as const, at };
			const { appended } = reconcile(root, file.path, found.text, at, origin);
			if (appended.length) onWritten(file.path, shell.notes.get(file.path) ?? null, appended);
		}
	};

	const factory = (pi: ExtensionAPI) => {
		pi.on("tool_call", async (event, ctx) => {
			if (!SHELL.has(event.toolName)) return;
			shells.set(event.toolCallId, {
				startedAt: Date.now(),
				sessionId: ctx.sessionManager.getSessionId(),
				// The assistant message that made the call: pi waits for the
				// session to catch up to it before tool_call runs.
				entryId: ctx.sessionManager.getLeafId() ?? undefined,
				...snapshot(),
			});
		});

		// Not tool_result: that one is skipped entirely when a call is blocked
		// by another extension or aborted mid-batch, and the listing put aside
		// for it would be held for the rest of the session. This one is emitted
		// either way.
		pi.on("tool_execution_end", async (event) => {
			const shell = shells.get(event.toolCallId);
			if (!shell) return;
			// Settled before it is forgotten, so the question it answers is asked
			// of this call too — and of any other still running beside it.
			settle(shell);
			shells.delete(event.toolCallId);
		});

		// A batch that is aborted leaves its later calls with no end of their
		// own. Every call of a turn is over by the turn's end, so anything still
		// here is never coming back.
		const forget = () => shells.clear();
		pi.on("turn_end", async () => forget());
		pi.on("agent_end", async () => forget());
	};

	return { factory, claim };
}
