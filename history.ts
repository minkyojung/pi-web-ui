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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { diffWordsWithSpace } from "diff";

export type Author = "me" | "pi" | "outside";

/** Where a change came from. Only pi's carry a place in a session. */
export type Origin = { author: Author; at: number; sessionId?: string; entryId?: string };

/**
 * `removed` was at [from, to) and `inserted` is there now. Kept whole so it can
 * be undone.
 *
 * `kept` is read only on a change that changes nothing — see isTouch. Such a
 * line is a decision about words already there rather than a write: true says
 * they are fine as they are, false takes that back. The log is append-only, so
 * a decision is unmade by writing its opposite, the way a ledger reverses an
 * entry rather than rubbing one out.
 */
export type Change = Origin & { from: number; to: number; inserted: string; removed: string; kept?: boolean };

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

/**
 * Words pi took out of the note, and where they stood.
 *
 * A span says who wrote the words that are there. This says what pi took away
 * that nothing replaced — words that left no span, because there is nothing
 * in the text for one to cover. It sits at one place, the seam where they
 * were, and moves with the text as a span does. Only pi's, since those are
 * the ones a person is asked to decide about, and the diff that asks needs
 * the words back to show them. A decision at that exact place, of no width,
 * is what sets `accepted`.
 */
export type Removal = Origin & { pos: number; removed: string; accepted?: true };

/** A change that changes nothing: the person deciding about the words at [from, to). */
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
 * Removals ride along, each at its seam, moved the way a place is moved
 * through a change — see mapThrough.
 */
export type Replayed = { text: string; spans: Span[]; removals: Removal[] };

export function replay(changes: Change[], from?: Replayed): Replayed {
	let text = from ? from.text : "";
	// Copied, since what is handed in may be held by whoever handed it in —
	// a snapshot read once and resumed from more than once.
	let spans: Span[] = from ? from.spans.map((s) => ({ ...s })) : [];
	let removals: Removal[] = from ? from.removals.map((r) => ({ ...r })) : [];
	for (const change of changes) {
		if (isTouch(change)) {
			// An older log has no `kept` on its touches, and every touch it holds
			// was an acceptance; undefined has to read as true.
			const kept = change.kept !== false;
			spans = merge(touch(spans, change.from, change.to, kept));
			removals = removals.map((r) => (change.from <= r.pos && r.pos <= change.to ? decideRemoval(r, kept) : r));
			continue;
		}
		const delta = change.inserted.length - (change.to - change.from);
		removals = removals.map((r) => ({ ...r, pos: mapThrough([change], r.pos) }));
		if (!change.inserted && change.removed && change.author === "pi") {
			const { from, to: _t, inserted: _i, removed, ...origin } = change;
			removals.push({ ...origin, pos: from, removed });
		}
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
	return { text, spans, removals };
}

function decideRemoval(removal: Removal, accepted: boolean): Removal {
	const { accepted: _was, ...rest } = removal;
	return accepted ? { ...rest, accepted: true } : rest;
}

/**
 * A run of the note that pi changed and the person has not decided about,
 * with what stood there before pi did.
 *
 * In the coordinates of the text as it is. Of no width when pi took words
 * away and put none back. `removed` is not what pi's one change replaced but
 * what the note had there before any of pi's undecided changes: two of pi's
 * changes to the same words are one hole, and so is a change of the person's
 * inside one — see unreviewed.
 */
export type Hole = { from: number; to: number; removed: string; accepted?: true };

/**
 * The note as it would be with every undecided change of pi's put back —
 * "before", for a diff against the note as it is.
 *
 * Not kept anywhere: a second reading of the same log, beside replay's. It
 * walks the changes carrying the holes — pi's undecided runs — and at the end
 * fills each with what it displaced. Two rules decide what a hole is:
 *
 * - A change of pi's opens one, or widens the one it lands in. Two changes
 *   to the same words are one thing to decide about.
 * - A change of the person's inside a hole joins it. Cursor and Zed diff the
 *   file as it is against the file as it was and get the same answer; the
 *   alternative, telling the person's words from pi's inside one chunk, would
 *   need a chunk to have more than one author, and a decision to be about
 *   less than a chunk. The chunk is the unit, and what is in it is the chunk's.
 *   Inside, not at the edge: typing on from the end of pi's words is the
 *   person's, as a mark in the editor does not grow at its end — and putting
 *   the chunk back must not take their words with it.
 *
 * A decision (isTouch) covering a hole whole closes it, and its opposite opens
 * it again; a decision of no width is about the hole of no width at that
 * place. A decision covering part of a hole leaves it open — a chunk is
 * decided about whole, and one from before that was possible waits for a
 * decision that covers it.
 */
export type Holed = { text: string; holes: Hole[] };

/**
 * The walk itself, resumable, carrying every hole — including the ones that
 * are not offered. `unreviewed` is this and then the reading of it; a caller
 * that wants to stop partway and come back later wants this one, since what
 * it leaves out is exactly what a later change of pi's may widen.
 */
export function holesOf(changes: Change[], from?: Holed): Holed {
	let text = from ? from.text : "";
	let holes: Hole[] = from ? from.holes.map((h) => ({ ...h })) : [];
	for (const change of changes) {
		if (isTouch(change)) {
			const kept = change.kept !== false;
			holes = holes.map((h) => {
				const covered = h.from === h.to ? change.from <= h.from && h.from <= change.to : change.from <= h.from && h.to <= change.to;
				if (!covered) return h;
				const { accepted: _was, ...rest } = h;
				return kept ? { ...rest, accepted: true } : rest;
			});
			continue;
		}
		const delta = change.inserted.length - (change.to - change.from);
		// The holes this change lands in. Overlap, not adjacency: typing on from
		// the end of pi's words is not a change to them, as a mark in the editor
		// does not grow at its end. A hole of no width is a seam, and a change
		// at either edge of it is at it — so a deletion and an insertion at one
		// place become one hole.
		const touched = holes.filter((h) =>
			h.from === h.to ? change.from <= h.from && h.from <= change.to : change.from < h.to && h.from < change.to,
		);
		if (change.author === "pi" || touched.length) {
			const from = Math.min(change.from, ...touched.map((h) => h.from));
			const to = Math.max(change.to, ...touched.map((h) => h.to));
			// What the note had across [from, to) before pi: the text there, with
			// each hole's own displaced words in place of what fills it now.
			let removed = "";
			let at = from;
			for (const h of touched) {
				removed += text.slice(at, h.from) + h.removed;
				at = h.to;
			}
			removed += text.slice(at, to);
			// pi's words are new and undecided; the person's inside a hole leave
			// its standing as it was.
			const accepted = change.author !== "pi" && touched.every((h) => h.accepted);
			const merged: Hole = { from, to: to + delta, removed, ...(accepted ? { accepted: true } : {}) };
			holes = [...holes.filter((h) => !touched.includes(h)).map((h) => (h.from >= change.to ? { ...h, from: h.from + delta, to: h.to + delta } : h)), merged];
			holes.sort((a, b) => a.from - b.from);
			// Two holes end to end, standing the same way, are one: what each
			// displaced sits end to end in "before" just as they do in the text.
			holes = holes.reduce<Hole[]>((out, h) => {
				const last = out[out.length - 1];
				if (last && last.to === h.from && !!last.accepted === !!h.accepted) last.to = h.to, (last.removed += h.removed);
				else out.push({ ...h });
				return out;
			}, []);
		} else {
			holes = holes.map((h) => (h.from >= change.to ? { ...h, from: h.from + delta, to: h.to + delta } : h));
		}
		text = apply(text, change);
	}
	return { text, holes };
}

export function unreviewed(changes: Change[], from?: Holed): { text: string; before: string; holes: Hole[] } {
	const { text, holes } = holesOf(changes, from);
	// Open, and open to a difference: a hole whose words the person has put
	// back by hand reads the same either way, and there is nothing in it to
	// decide. It stays in the log's reading, since a later change of pi's
	// there may widen it, but it is not offered.
	const open = holes.filter((h) => !h.accepted && text.slice(h.from, h.to) !== h.removed);
	let before = text;
	for (const h of [...open].reverse()) before = before.slice(0, h.from) + h.removed + before.slice(h.to);
	return { text, before, holes: open };
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

/**
 * Say whether what lies in [from, to) is accepted, cutting spans at the edges.
 *
 * A touch that covers a span whole leaves it whole, so what it replaced is
 * still known and taking the acceptance back gives the span back exactly as it
 * was. One that covers part of it cannot: the part is no longer the whole of
 * what its change wrote, and that is true however the decision goes.
 */
function touch(spans: Span[], from: number, to: number, accepted: boolean): Span[] {
	const out: Span[] = [];
	for (const span of spans) {
		if (span.to <= from || span.from >= to) {
			out.push(span);
			continue;
		}
		const { removed: _cut, ...rest } = span;
		const whole = span.from >= from && span.to <= to;
		if (span.from < from) out.push({ ...rest, to: from });
		const middle: Span = { ...(whole ? span : rest), from: Math.max(span.from, from), to: Math.min(span.to, to) };
		if (accepted) middle.accepted = true;
		else delete middle.accepted;
		out.push(middle);
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

export const readHistory = (root: string, path: string): Change[] => readLog(historyPath(root, path));

function readLog(file: string): Change[] {
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

/** A trashed note's log waits here, under the note's own path — with a time added when that name is taken. */
export function trashHistoryPath(root: string, trashed: string): string {
	return join(root, ".pi", "trash", "history", `${trashed}.jsonl`);
}

/**
 * A deleted note's log steps aside rather than going with it.
 *
 * It cannot stay: a new note made at the same name would inherit the deleted
 * one's past, and "who wrote which words" would be answering about a note that
 * is gone. It cannot be thrown away either: the note may come back, from the
 * machine's trash or from ours, and it is the one thing about a note that
 * cannot be rebuilt from the note.
 *
 * The name it waits under is the note's own, with a time added if a log from
 * an earlier deletion is already there — the same rule the note itself follows
 * into `.pi/trash/notes/`.
 */
export function trashLog(root: string, path: string, now = new Date()): void {
	let name = path;
	if (existsSync(trashHistoryPath(root, name))) name = `${path} ${now.toISOString().replace(/[:.]/g, "-")}`;
	moveLog(historyPath(root, path), trashHistoryPath(root, name));
}

/**
 * A note has appeared where one was deleted. Is it the one that was deleted?
 *
 * It is decidable rather than a guess, and the log itself is what decides:
 * replaying it gives the text the app last knew the note to be, so a log whose
 * replay is exactly what is on disk now is the log of this note. Put Back in
 * the Finder brings a file home byte for byte, and that is the case this
 * answers — the note comes back and its past comes back with it. A different
 * note that happens to take the name replays to something else, and its own
 * history starts empty, as it should.
 *
 * Only asked when a note has no log at all, and answered with nothing where
 * there is no trash to look in, which is the usual state of a folder.
 */
export function reclaimLog(root: string, path: string, onDisk: string): Change[] | null {
	const waiting = trashHistoryPath(root, path);
	const dir = dirname(waiting);
	if (!existsSync(dir)) return null;
	const base = basename(path);
	// The name it waits under is the note's, or the note's with a time added.
	const mine = (name: string) => name === `${base}.jsonl` || (name.startsWith(`${base} `) && name.endsWith(".jsonl"));
	const candidates = readdirSync(dir)
		.filter(mine)
		.map((name) => join(dir, name))
		// Newest first: a note deleted twice comes back as the last one deleted.
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	for (const file of candidates) {
		const changes = readLog(file);
		if (replay(changes).text !== onDisk) continue;
		moveLog(file, historyPath(root, path));
		return changes;
	}
	return null;
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
	// A note with no log is either new or back from the trash, and the trash is
	// asked before the note is seeded as new — see reclaimLog.
	const changes = readHistory(root, path);
	if (changes.length === 0) changes.push(...(reclaimLog(root, path, onDisk) ?? []));
	const walked = replay(changes);
	let appended: Change[] = [];
	if (walked.text !== onDisk) {
		appended = changesBetween(walked.text, onDisk, origin);
		appendHistory(root, path, appended);
		changes.push(...appended);
	}
	// The walk again is only for what was just appended, and there is usually
	// nothing: the disk agrees with the log every time but the first of a write
	// that came from somewhere else. Walking a log twice to learn the same
	// thing costs what walking it once costs, which on a long one is not little.
	return { changes, appended, spans: appended.length === 0 ? walked.spans : replay(changes).spans };
}

/**
 * Log what the person decided about the words at [from, to): `kept` for fine as
 * they are, false for back to being looked at.
 *
 * A range of no width is a decision about words that are not there — the
 * removal at that place — and is written only if there is one, so a decision
 * about nothing leaves no line.
 */
export function decide(root: string, path: string, from: number, to: number, at: number, kept: boolean): void {
	const { text, removals } = replay(readHistory(root, path));
	const words = text.slice(from, to);
	if (!words && !removals.some((r) => r.pos === from)) return;
	appendHistory(root, path, [{ author: "me", at, from, to, inserted: words, removed: words, kept }]);
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
