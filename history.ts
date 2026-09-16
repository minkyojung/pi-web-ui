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

import { forgetSnapshot, readSnapshot, writeSnapshot } from "./snapshot.ts";

/**
 * Who wrote. `before` is the one that is not a writer: the words a note had
 * when the app first read it, which nobody was seen to write. A note the app
 * did not know cannot have its change told from its text, so the whole of it
 * is seeded as `before` and none of it is marked — the cheap wrong answer,
 * beside handing every word the person ever wrote to "outside".
 */
export type Author = "me" | "pi" | "outside" | "before";

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
export type Change = Origin & { from: number; to: number; inserted: string; removed: string; kept?: boolean; spans?: Carried[] };

/**
 * A run of an insertion that keeps an author of its own: words that were
 * moved here, with who wrote them where they were. Offsets are within
 * `inserted`. A change carries these when the writer said the words came from
 * somewhere and the record could look up whose they were there (fromEdits);
 * the change's own origin is who moved them, and stands for whatever of the
 * insertion the runs do not cover.
 */
export type Carried = Origin & { from: number; to: number };

/** The runs, if they are runs of this insertion: in order, apart, and inside it. Anything else is ignored rather than drawn wrong. */
function carriedBy(change: Change): Carried[] {
	const runs = change.spans ?? [];
	let at = 0;
	for (const r of runs) {
		if (!(Number.isInteger(r.from) && Number.isInteger(r.to)) || r.from < at || r.to <= r.from || r.to > change.inserted.length) return [];
		at = r.to;
	}
	return runs;
}

/**
 * A run of characters in the current text with one origin.
 *
 * `removed` is what the change that wrote it replaced, carried while the span
 * is still that whole insertion and dropped once later changes have cut it —
 * it is what putting the words back means, and only means it whole.
 *
 * A span says who wrote, and nothing about whether it has been decided about:
 * that is the other reading of the log, holesOf, which is where what pi took
 * away and what the person has kept are kept.
 */
export type Span = Origin & { from: number; to: number; removed?: string };

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
 * A decision (isTouch) changes no text and so changes no span.
 */
export type Replayed = { text: string; spans: Span[] };

export function replay(changes: Change[], from?: Replayed): Replayed {
	let text = from ? from.text : "";
	// Copied, since what is handed in may be held by whoever handed it in —
	// a snapshot read once and resumed from more than once.
	let spans: Span[] = from ? from.spans.map((s) => ({ ...s })) : [];
	for (const change of changes) {
		if (isTouch(change)) continue;
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
			const { from: _f, to: _t, inserted: _i, removed, spans: _s, ...origin } = change;
			const carried = carriedBy(change);
			if (carried.length === 0) next.push({ ...origin, from: change.from, to: change.from + change.inserted.length, removed });
			else {
				// The moved words keep their authors; what is between and around
				// them is the mover's. None of it is the whole of what this change
				// wrote, so none of it says what it replaced.
				let at = 0;
				for (const run of carried) {
					const { from: rf, to: rt, ...theirs } = run;
					if (rf > at) next.push({ ...origin, from: change.from + at, to: change.from + rf });
					next.push({ ...theirs, from: change.from + rf, to: change.from + rt });
					at = rt;
				}
				if (at < change.inserted.length) next.push({ ...origin, from: change.from + at, to: change.from + change.inserted.length });
			}
		}
		next.sort((a, b) => a.from - b.from);
		spans = merge(next);
		text = apply(text, change);
	}
	return { text, spans };
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

/**
 * The reading of a walk: what there is to decide about, and the note as it
 * would be with all of it put back.
 *
 * Open, and open to a difference: a hole whose words the person has put back
 * by hand reads the same either way, and there is nothing in it to decide. It
 * stays in the walk's state, since a later change of pi's there may widen it,
 * but it is not offered.
 */
export function undecided({ text, holes }: Holed): { text: string; before: string; holes: Hole[] } {
	const open = holes.filter((h) => !h.accepted && text.slice(h.from, h.to) !== h.removed);
	let before = text;
	for (const h of [...open].reverse()) before = before.slice(0, h.from) + h.removed + before.slice(h.to);
	return { text, before, holes: open };
}

export const unreviewed = (changes: Change[], from?: Holed) => undecided(holesOf(changes, from));

/**
 * Did pi write to this note in a given run — the session, and the stretch of
 * time from the run's first message to its last?
 *
 * A run is known by when it was, not by which messages it held: a change of
 * pi's is stamped with the session and the moment it was written, and a run
 * has a beginning and an end, so the two meet without the log having to know
 * anything about how a conversation is shaped. Only pi's — a change of the
 * person's in the same minutes is theirs, whatever pi was doing.
 */
export function wroteIn(changes: Change[], sessionId: string, from: number, to: number): boolean {
	return changes.some((c) => c.author === "pi" && c.sessionId === sessionId && from <= c.at && c.at <= to && !isTouch(c));
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

function same(a: Span, b: Span): boolean {
	return a.author === b.author && a.at === b.at && a.sessionId === b.sessionId && a.entryId === b.entryId;
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

export const readHistory = (root: string, path: string): Change[] => readLog(historyPath(root, path)).changes;

/**
 * Does a note's log so much as mention a word — a session's id, say?
 *
 * Asked of every note in a folder before any log is parsed, so that a
 * question about one session reads only the logs that could answer it. A
 * note with no log mentions nothing.
 */
export function logNames(root: string, path: string, word: string): boolean {
	const file = historyPath(root, path);
	return existsSync(file) && readFileSync(file, "utf8").includes(word);
}

/**
 * The log's lines and what they say, side by side.
 *
 * A line that will not parse is not part of the log — a torn last line from a
 * crash mid-append — and is left out of both, so that the nth change is the
 * nth line and a snapshot covering n of one covers n of the other.
 */
function readLog(file: string): { raw: string[]; changes: Change[] } {
	const raw = linesOf(file);
	return { raw, changes: raw.map(parseLine) };
}

/**
 * The shape of a line, written on every line from now on and read off it.
 *
 * The log is the one thing in the vault that cannot be rebuilt, so it is never
 * rewritten; what changes is how a line is read, and a reader has to know
 * which shape it is reading. A line with no `v` is from before there was one.
 */
const LOG_V = 2;

/**
 * One line of the log, as a change. `v` is about the line and not the
 * change, and is read off here.
 *
 * Before `before` was a word, a note the app found was seeded as "outside",
 * whole. Such a line is the first, says it seeded — it starts at nothing —
 * and has no `v`. It reads as `before` now, as a touch with no `kept` reads
 * as an acceptance, so that a vault opened for the first time a year ago is
 * not a vault whose every note is marked as someone else's. A line with a `v`
 * that says "outside" at the start of a log means it: the note appeared in a
 * folder that did not have it.
 *
 * v2 added `spans` on a change, the authors of words moved into it. A v1
 * reader would have taken them as the mover's, which is what this reader does
 * with a line that has none; nothing else about a line changed.
 */
function parseLine(line: string, index: number): Change {
	const { v, ...change } = JSON.parse(line) as Change & { v?: number };
	if (v === undefined && index === 0 && change.author === "outside" && change.from === 0 && change.to === 0) return { ...change, author: "before" };
	return change;
}

/**
 * The log's lines, the ones that are lines: a blank tail, and a last one torn
 * by a crash mid-append, are not. Read without parsing, since a line the
 * snapshot already covers never has to become anything.
 */
function linesOf(file: string): string[] {
	if (!existsSync(file)) return [];
	const out: string[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line) continue;
		try {
			JSON.parse(line);
			out.push(line);
		} catch {
			// A torn last line from a crash mid-append. Everything before it holds.
		}
	}
	return out;
}

/**
 * How long a walk has to take before its answer is worth writing down beside
 * the log. Most notes never reach it and never grow a snapshot; one that does
 * reaches it once and then walks only what came after.
 */
const SLOW_MS = 20;

/** How long the log is, and what it says. */
export type Read = { lines: number; replayed: Replayed; holed: Holed };

/**
 * What a note's log says, leaning on the snapshot beside it — see snapshot.ts.
 *
 * Both walks, since the two questions are always asked about the same note in
 * the same breath: what it says and who wrote it, and what is still to decide
 * about. Walking is where the cost is, and with a snapshot each walk is only
 * the lines since it.
 */
export function historyOf(root: string, path: string, slowMs = SLOW_MS): Read {
	const file = historyPath(root, path);
	const raw = linesOf(file);
	const snap = readSnapshot(file, raw);
	// Only the lines the snapshot does not cover are turned into changes. On a
	// long log the parsing is most of what is left once the walk is short, and
	// a line already answered for never has to become anything.
	const skip = snap ? snap.lines : 0;
	const tail = raw.slice(skip).map((line, i) => parseLine(line, skip + i));
	const started = performance.now();
	const replayed = replay(tail, snap ? { text: snap.text, spans: snap.spans } : undefined);
	const holed = holesOf(tail, snap ? { text: snap.text, holes: snap.holes } : undefined);
	if (performance.now() - started > slowMs && raw.length > 0) {
		writeSnapshot(file, raw, { text: replayed.text, spans: replayed.spans, holes: holed.holes });
	}
	return { lines: raw.length, replayed, holed };
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
		const { changes } = readLog(file);
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
	// The answer worked out beside a log does not travel with it, and the one
	// at the far end was about whatever used to be there. Both go: a cache is
	// cheaper to work out again than to keep right through a move.
	forgetSnapshot(src);
	forgetSnapshot(dst);
}

export function appendHistory(root: string, path: string, changes: Change[]): void {
	if (changes.length === 0) return;
	const file = historyPath(root, path);
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, changes.map((c) => JSON.stringify({ v: LOG_V, ...c })).join("\n") + "\n");
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
 * Whose that is, the caller says when it knows — the note appeared in a
 * folder that did not have it (server.ts, settleDisk). When
 * it does not, there are two answers and not one: a difference from what the
 * log knew is "outside", since somebody made it; a note with no log at all is
 * "before", since nobody was seen to. The log is append-only and has no line
 * that changes an earlier line's author, so the answer has to be right as it
 * is written.
 */
export function reconcile(
	root: string,
	path: string,
	onDisk: string,
	at: number,
	origin?: Origin,
): { appended: Change[]; spans: Span[]; replayed: Replayed; holed: Holed } {
	// A note with no log is either new or back from the trash, and the trash is
	// asked before the note is seeded as new — see reclaimLog.
	let read = historyOf(root, path);
	// A note with no log is either new or back from the trash; reclaiming puts
	// a log where there was none, so what it says is read again.
	if (read.lines === 0 && reclaimLog(root, path, onDisk)) read = historyOf(root, path);
	let { replayed, holed } = read;
	let appended: Change[] = [];
	if (replayed.text !== onDisk) {
		appended = changesBetween(replayed.text, onDisk, origin ?? { author: read.lines === 0 ? "before" : "outside", at });
		appendHistory(root, path, appended);
		// Only the new lines, on top of what was just worked out.
		replayed = replay(appended, replayed);
		holed = holesOf(appended, holed);
	}
	return { appended, spans: replayed.spans, replayed, holed };
}

/**
 * Does a decision at [from, to) hold a whole hole?
 *
 * The same question the log's own reading asks when it closes one, and asked
 * here for a different reason: to find out whether these two places are places
 * in the note the record has. Every decision the app can make is made on a
 * chunk of the diff, and a chunk holds the holes under it whole — so a pair of
 * places that holds none is not a decision about part of something, it is a
 * pair of places from a different text. A tab one keystroke ahead of the
 * record sends exactly that: the same chunk, every offset out by one, holding
 * the hole all but its first character.
 *
 * Wider than a hole is fine — a chunk can be wider, and can hold two. Narrower
 * or shifted is not, and that is the whole of the check.
 *
 * Every hole rather than the offered ones, since a decision may also be one
 * taken back, and that lands on a hole which is closed at the time. A hole of
 * no width is where pi took words away and put none back: a decision about one
 * is about the seam, so it is held when the seam is inside the range.
 */
const decides = (holes: Hole[], from: number, to: number): boolean =>
	holes.some((h) => (h.from === h.to ? from <= h.from && h.from <= to : from <= h.from && h.to <= to));

/**
 * Log what the person decided about the words at [from, to): `kept` for fine as
 * they are, false for back to being looked at. False when those places name
 * nothing to decide, and then nothing is written.
 *
 * Checked rather than taken, because the places come from a tab and name
 * positions in the note as that tab has it. A tab a keystroke ahead of the
 * record sends places a character out, and the line that would be written then
 * is a decision about the wrong words: it closes nothing, so the diff comes
 * straight back, and it stays in the log for good — marking words as looked at
 * that nobody looked at. The log is the one thing here that cannot be rebuilt,
 * so what goes into it is checked against what it already says.
 */
export function decide(root: string, path: string, from: number, to: number, at: number, kept: boolean): boolean {
	const { replayed, holed } = historyOf(root, path);
	if (!decides(holed.holes, from, to)) return false;
	const words = replayed.text.slice(from, to);
	appendHistory(root, path, [{ author: "me", at, from, to, inserted: words, removed: words, kept }]);
	return true;
}

/**
 * One edit as the editor made it: [from, to) of the text it started from
 * replaced by `insert`. Side by side, all in that one text's coordinates —
 * the shape CodeMirror's ChangeSet hands out — where a log line is in the
 * text as it stands when that line is applied.
 */
export type Edit = { from: number; to: number; insert: string };

/**
 * The editor's own account of what it did, as log lines — or null when the
 * account does not add up.
 *
 * The editor knows exactly what it changed, and says so; this is where it is
 * believed, and the one condition on believing it: applying the edits to the
 * text it started from must give the text it ended with, to the character.
 * An account that does not — a tab out of step, an older client — is not
 * argued with but set aside, and the caller falls back to reading the change
 * off the two texts. So the record is exact when it can be and never wrong
 * when it cannot.
 *
 * Side-by-side edits become in-order lines by walking them in order: once the
 * earlier ones are in, the next one's place has moved by what they added and
 * took, which is the sum kept in `shift`.
 */
export function fromEdits(before: string, edits: Edit[], after: string, origin: Origin): Change[] | null {
	const out: Change[] = [];
	let shift = 0;
	let last = 0;
	for (const e of edits) {
		if (!(Number.isInteger(e.from) && Number.isInteger(e.to) && typeof e.insert === "string")) return null;
		if (e.from < last || e.to < e.from || e.to > before.length) return null;
		const removed = before.slice(e.from, e.to);
		if (e.insert === removed) continue; // Nothing done; a line of it would read as a decision (isTouch).
		out.push({ ...origin, from: e.from + shift, to: e.to + shift, inserted: e.insert, removed });
		shift += e.insert.length - removed.length;
		last = e.to;
	}
	let text = before;
	for (const c of out) text = apply(text, c);
	return text === after ? out : null;
}

/**
 * Log a write that passed through the app, from what it replaced — and, when
 * the writer said exactly what it changed, as it said (fromEdits).
 */
export function record(root: string, path: string, before: string, after: string, origin: Origin, edits?: Edit[]): Change[] {
	// `before` is what the writer had; the disk may have moved past it. Settle
	// that first so this change is measured from the real text.
	reconcile(root, path, before, origin.at);
	const changes = (edits && fromEdits(before, edits, after, origin)) ?? changesBetween(before, after, origin);
	appendHistory(root, path, changes);
	return changes;
}
