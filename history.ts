/**
 * Who wrote which characters of a note, kept as the changes that got it there.
 *
 * One append-only log per note under .pi/history/, one line per change. The
 * first line seeds it with the whole text as it was first seen; every line
 * after is a replacement of one range. Replaying the lines from an empty
 * string gives the text back — which is how a note changed behind the app's
 * back is noticed: what the log says the note is and what the disk says
 * differ, and the difference is logged as written by "outside".
 *
 * Every writer is recorded the same way, from the text before and the text
 * after. The editor could say exactly what it changed and pi's edit tool could
 * too, but one path is easier to trust than three, and a diff of a note is
 * cheap.
 *
 * Offsets are UTF-16 code units, which is what both JavaScript strings and
 * CodeMirror count in.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { diffWordsWithSpace } from "diff";

export type Author = "me" | "pi" | "outside";

/** Where a change came from. Only pi's carry a place in a session. */
export type Origin = { author: Author; at: number; sessionId?: string; entryId?: string };

/** `removed` was at [from, to) and `inserted` is there now. Kept whole so it can be undone. */
export type Change = Origin & { from: number; to: number; inserted: string; removed: string };

/**
 * A run of characters in the current text with one origin.
 *
 * `removed` is what the change that wrote it replaced, carried while the span
 * is still that whole insertion and dropped once later changes have cut it —
 * it is what putting the words back means, and only means it whole.
 * `accepted` is set when the person has touched the run without changing it,
 * which is how pi's words stop being marked without becoming anyone else's.
 */
export type Span = Origin & { from: number; to: number; removed?: string; accepted?: true };

/** A change that changes nothing: the person accepting the words at [from, to). */
export const isTouch = (change: Change) => change.inserted === change.removed;

/**
 * The replacements that turn `before` into `after`, in order.
 *
 * Each one's offsets are in the text as it is when that one is applied — the
 * earlier ones already in — which is what lets a log be replayed by applying
 * its lines one after another. Word-level, since that is the grain the screen
 * draws at, and it keeps a reworded sentence to one line instead of a dozen.
 */
export function changesBetween(before: string, after: string, origin: Origin): Change[] {
	const out: Change[] = [];
	let pos = 0;
	let pending: Change | null = null;
	const flush = () => {
		if (!pending) return;
		out.push(pending);
		pos += pending.inserted.length;
		pending = null;
	};
	for (const part of diffWordsWithSpace(before, after)) {
		if (part.removed || part.added) {
			pending ??= { ...origin, from: pos, to: pos, inserted: "", removed: "" };
			if (part.removed) {
				pending.to += part.value.length;
				pending.removed += part.value;
			} else {
				pending.inserted += part.value;
			}
		} else {
			flush();
			pos += part.value.length;
		}
	}
	flush();
	return out;
}

/** The text after a change. */
export function apply(text: string, change: Change): string {
	return text.slice(0, change.from) + change.inserted + text.slice(change.to);
}

/**
 * The text and its authorship after every change in order.
 *
 * Spans are cut where a change starts and ends, the middle is dropped, the
 * insertion takes its place, and what follows is shifted. Adjacent spans with
 * the same origin are merged so the answer stays as short as the text allows.
 */
export function replay(changes: Change[]): { text: string; spans: Span[] } {
	let text = "";
	let spans: Span[] = [];
	for (const change of changes) {
		if (isTouch(change)) {
			spans = merge(touch(spans, change.from, change.to));
			continue;
		}
		const delta = change.inserted.length - (change.to - change.from);
		const next: Span[] = [];
		for (const span of spans) {
			if (span.to <= change.from) next.push(span);
			else if (span.from >= change.to) next.push({ ...span, from: span.from + delta, to: span.to + delta });
			else {
				// Straddles the change: keep the parts outside it. A part is no
				// longer the whole of what its change wrote.
				const { removed: _cut, ...rest } = span;
				if (span.from < change.from) next.push({ ...rest, to: change.from });
				if (span.to > change.to) next.push({ ...rest, from: change.from + change.inserted.length, to: span.to + delta });
			}
		}
		if (change.inserted) {
			const { from: _f, to: _t, inserted: _i, removed, ...origin } = change;
			next.push({ ...origin, from: change.from, to: change.from + change.inserted.length, removed });
		}
		next.sort((a, b) => a.from - b.from);
		spans = merge(next);
		text = apply(text, change);
	}
	return { text, spans };
}

/**
 * Where a place in a note has moved to, after the changes since.
 *
 * A change lies before the place, after it, or around it: before, the place
 * shifts by what the change added or took; after, it does not move; around,
 * the text it named is gone and the place collapses to the end of what took
 * its place. The arithmetic CodeMirror's mapPos does over a change set — the
 * log is the change set here.
 *
 * Two places mapped this way come out equal when everything between them was
 * replaced whole, which is how a chosen part of a note is known to be gone.
 */
export function mapThrough(changes: Change[], pos: number): number {
	for (const change of changes) {
		if (isTouch(change)) continue;
		if (change.to <= pos) pos += change.inserted.length - (change.to - change.from);
		else if (change.from < pos) pos = change.from + change.inserted.length;
	}
	return pos;
}

/** Mark what lies in [from, to) as accepted, cutting spans at the edges. */
function touch(spans: Span[], from: number, to: number): Span[] {
	const out: Span[] = [];
	for (const span of spans) {
		if (span.to <= from || span.from >= to) {
			out.push(span);
			continue;
		}
		const { removed: _cut, ...rest } = span;
		const whole = span.from >= from && span.to <= to;
		if (span.from < from) out.push({ ...rest, to: from });
		out.push({ ...(whole ? span : rest), from: Math.max(span.from, from), to: Math.min(span.to, to), accepted: true });
		if (span.to > to) out.push({ ...rest, from: to });
	}
	return out;
}

function same(a: Span, b: Span): boolean {
	return (
		a.author === b.author &&
		a.at === b.at &&
		a.sessionId === b.sessionId &&
		a.entryId === b.entryId &&
		a.accepted === b.accepted
	);
}

function merge(spans: Span[]): Span[] {
	const out: Span[] = [];
	for (const span of spans) {
		if (span.from === span.to) continue;
		const last = out[out.length - 1];
		if (last && last.to === span.from && same(last, span)) {
			// Two pieces of one span, or two spans: either way not one whole insertion.
			last.to = span.to;
			delete last.removed;
		} else out.push({ ...span });
	}
	return out;
}

// ---------------------------------------------------------------------------
// On disk

export const HISTORY_DIR = ".pi/history";

/** `.pi/history/<note path>.jsonl`, keeping the note's own folders. */
export function historyPath(root: string, path: string): string {
	return join(root, HISTORY_DIR, `${path}.jsonl`);
}

export function readHistory(root: string, path: string): Change[] {
	const file = historyPath(root, path);
	if (!existsSync(file)) return [];
	const out: Change[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			// A torn last line from a crash mid-append. Everything before it holds.
		}
	}
	return out;
}

/** The log follows its note to a new path. A note with no log yet has nothing to move. */
export function moveHistory(root: string, from: string, to: string): void {
	moveLog(historyPath(root, from), historyPath(root, to));
}

/** A trashed note's log waits in the trash beside it, under the same name it was trashed as. */
export function trashHistoryPath(root: string, trashed: string): string {
	return join(root, ".pi", "trash", "history", `${trashed}.jsonl`);
}

export function moveLog(src: string, dst: string): void {
	if (!existsSync(src)) return;
	mkdirSync(dirname(dst), { recursive: true });
	renameSync(src, dst);
}

export function appendHistory(root: string, path: string, changes: Change[]): void {
	if (changes.length === 0) return;
	const file = historyPath(root, path);
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, changes.map((c) => JSON.stringify(c)).join("\n") + "\n");
}

/**
 * Bring the log up to what is on disk, and say who wrote what.
 *
 * The log's replay is what the app last knew the note to be. If the disk
 * differs, someone wrote without passing through here — pi's bash, another
 * editor — and the difference is logged first, so that a change about to be
 * recorded is measured from what is really there. A note with no log yet is
 * seeded whole the same way.
 *
 * Whose that difference is, the caller says. "outside" is the answer when
 * nobody claims it, and the only one this file can work out on its own; a
 * caller that knows pi's shell was running says so instead — see recorder.ts.
 * The log is append-only and has no line that changes an earlier line's
 * author, so the answer has to be right as it is written.
 */
export function reconcile(
	root: string,
	path: string,
	onDisk: string,
	at: number,
	origin: Origin = { author: "outside", at },
): { changes: Change[]; appended: Change[]; spans: Span[] } {
	const changes = readHistory(root, path);
	const { text } = replay(changes);
	let appended: Change[] = [];
	if (text !== onDisk) {
		appended = changesBetween(text, onDisk, origin);
		appendHistory(root, path, appended);
		changes.push(...appended);
	}
	return { changes, appended, spans: replay(changes).spans };
}

/** Log that the person accepted the words at [from, to) as they are. */
export function accept(root: string, path: string, from: number, to: number, at: number): void {
	const { text } = replay(readHistory(root, path));
	const kept = text.slice(from, to);
	if (!kept) return;
	appendHistory(root, path, [{ author: "me", at, from, to, inserted: kept, removed: kept }]);
}

/** Log a write that passed through the app, from what it replaced. */
export function record(root: string, path: string, before: string, after: string, origin: Origin): Change[] {
	// `before` is what the writer had; the disk may have moved past it. Settle
	// that first so this change is measured from the real text.
	reconcile(root, path, before, origin.at);
	const changes = changesBetween(before, after, origin);
	appendHistory(root, path, changes);
	return changes;
}
