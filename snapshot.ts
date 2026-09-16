/**
 * The answer to a note's log, written down beside it so it is not worked out
 * from the beginning every time.
 *
 * The log is append-only and says what happened; what the app needs is what
 * that adds up to — the note's text, who wrote which of its words, and what is
 * still to be decided about. Working that out costs more than linear in the
 * length of the log, and it is done on every open and four times over on every
 * save, so a note edited for a few weeks takes seconds to answer about. This
 * is the standard answer to that in a log-shaped store, from Redis's rewritten
 * AOF to Akka's snapshot store: keep the running answer, and replay only what
 * came after it.
 *
 * Beside the log rather than inside it. The log's own format does not change,
 * so nothing that reads a log has to learn anything, and this file is a cache
 * in the strict sense — delete it and the only thing lost is speed, the way
 * `.pi/links.json` can be deleted and rebuilt from the notes. That is worth
 * more here than saving a file: the log is the one thing in the vault that
 * cannot be rebuilt from anything else, and a format change to it is a change
 * to the only copy.
 *
 * A wrong snapshot would be worse than a slow one. What the app does with the
 * answer is compare it to the disk and write down the difference as somebody's
 * work — so a snapshot that does not belong to this log would invent an edit
 * and put a name on it. Hence the guard: it remembers how many lines of the
 * log it covers and a hash of exactly those lines, and anything that does not
 * match to the character is thrown away rather than repaired.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";

import { writeAtomic } from "./atomic.ts";
import type { Hole, Span } from "./history.ts";

export type Snapshot = {
	/** How many of the log's lines are in it. */
	lines: number;
	/** Of exactly those lines. See hashOf. */
	hash: string;
	/** What replay had got to. */
	text: string;
	spans: Span[];
	/** What the hole-finding walk had got to — every hole, offered or not. */
	holes: Hole[];
};

/** `.pi/history/<note>.md.snapshot.json`, beside `.pi/history/<note>.md.jsonl`. */
export const snapshotPath = (logFile: string): string => logFile.replace(/\.jsonl$/, ".snapshot.json");

/**
 * FNV-1a, 32 bits, over the log lines the snapshot covers.
 *
 * Not for secrecy — for telling one prefix from another, which is what a hash
 * is doing here. It is a handful of lines of arithmetic rather than a
 * dependency, and it reads half a megabyte in about a millisecond, which is
 * nothing beside the walk it saves.
 */
export function hashOf(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

/**
 * The snapshot beside `logFile`, if there is one and it is this log's.
 *
 * `lines` is the log as it is now. Anything unreadable, from a newer shape or
 * covering more lines than the log has, is nobody's business to repair: it is
 * a cache, and the walk it saves is the fallback.
 */
export function readSnapshot(logFile: string, lines: string[]): Snapshot | null {
	const file = snapshotPath(logFile);
	if (!existsSync(file)) return null;
	try {
		const snap = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
		if (typeof snap?.lines !== "number" || typeof snap.hash !== "string" || typeof snap.text !== "string") return null;
		if (!Array.isArray(snap.spans) || !Array.isArray(snap.holes)) return null;
		if (snap.lines > lines.length) return null;
		if (hashOf(lines.slice(0, snap.lines).join("\n")) !== snap.hash) return null;
		return snap;
	} catch {
		return null;
	}
}

export function writeSnapshot(logFile: string, lines: string[], state: Omit<Snapshot, "lines" | "hash">): void {
	const snap: Snapshot = { lines: lines.length, hash: hashOf(lines.join("\n")), ...state };
	writeAtomic(snapshotPath(logFile), JSON.stringify(snap));
}

/**
 * The log has moved, or gone. The answer to it goes with it — not to the new
 * place, since it is cheaper to work out again than to keep right through a
 * rename, a trip to the trash and a return from one.
 */
export function forgetSnapshot(logFile: string): void {
	rmSync(snapshotPath(logFile), { force: true });
}
