/**
 * Words cut and pasted keep their authors — because the editor saw the cut.
 *
 * To a diff of two texts a paragraph moved is a paragraph deleted and another
 * written, and whoever pasted it wrote it. The editor knows better at the
 * moment it happens: a cut is a transaction it can name (`delete.cut`), and
 * so is a paste (`input.paste`) and a drag of chosen words (`move.drop`). So
 * the cut is remembered — its words, and where in the record they stood: the
 * note, the range in the text the typing was over, and how long that note's
 * log was at that text — and a paste of exactly those words, into this note
 * or another, is sent with that place on it (Edit.moved). The record looks up
 * whose the words were there, then, and they stay theirs.
 *
 * Nothing is read from the clipboard and nothing is matched by resemblance.
 * Words that came from another app are new to this note and are the
 * person's, which is right; words cut here and pasted here are the one case
 * this file knows about, and it knows it as a fact.
 *
 * The one cut is kept across notes, since that is what a move between notes
 * is; pastes waiting for a save are kept per note and move with the text as
 * anything typed around them moves it.
 */
import type { ChangeDesc, Transaction } from "@codemirror/state";

import type { Edit, Moved } from "../types";

/** Where the note on screen stands in the record, at the moment of a change. */
export type Standing = {
	path: string;
	/** The log's length at the text the typing is over; null before the note has come. */
	lines: number | null;
	/** From a place on screen, before the change, to the same place in that text. */
	toBase: ChangeDesc;
};

type Cut = { text: string; moved: Moved };
/** A paste of the last cut, waiting for the save that carries it: where it starts on screen now. */
type Pending = { pos: number; text: string; moved: Moved };

let lastCut: Cut | null = null;
let pending: Pending[] = [];

type Range = { fromA: number; toA: number; fromB: number; toB: number; inserted: string; removed: string };

const rangesOf = (tr: Transaction): Range[] => {
	const out: Range[] = [];
	tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => out.push({ fromA, toA, fromB, toB, inserted: inserted.toString(), removed: tr.startState.sliceDoc(fromA, toA) }));
	return out;
};

/**
 * Look at what the person just did. Called for every update that changed the
 * text by their hand, before the editor folds it into the typing since the
 * last save — `toBase` is the way back from the text before this update.
 */
/** What of an update is looked at: its changes as a whole, and the transactions they came in. A ViewUpdate is one. */
export type Update = { changes: ChangeDesc; transactions: readonly Transaction[] };

export function observe(update: Update, standing: Standing): void {
	// Pastes already waiting move with the text.
	pending = pending.map((p) => ({ ...p, pos: update.changes.mapPos(p.pos, 1) }));
	// Places named below are in the text before the first transaction; the
	// update's later transactions are mapped over for a paste's place on screen.
	const [tr, ...later] = update.transactions;
	if (!tr?.docChanged) return;
	const onScreen = (pos: number) => later.reduce((p, t) => t.changes.mapPos(p, 1), pos);
	const ranges = rangesOf(tr);
	const source = (r: Range): Moved | null =>
		standing.lines === null ? null : { path: standing.path, from: standing.toBase.mapPos(r.fromA, -1), to: standing.toBase.mapPos(r.toA, 1), lines: standing.lines };
	if (tr.isUserEvent("delete.cut") && ranges.length === 1 && ranges[0].removed && !ranges[0].inserted) {
		const moved = source(ranges[0]);
		lastCut = moved ? { text: ranges[0].removed, moved } : null;
	} else if (tr.isUserEvent("input.paste") && ranges.length === 1 && lastCut && ranges[0].inserted === lastCut.text) {
		pending.push({ pos: onScreen(ranges[0].fromB), text: lastCut.text, moved: lastCut.moved });
	} else if (tr.isUserEvent("move.drop") && ranges.length === 2) {
		// Chosen words dragged elsewhere in the same note: one range gives them
		// up and the other takes them, in one transaction.
		const gone = ranges.find((r) => r.removed && !r.inserted);
		const came = ranges.find((r) => r.inserted && !r.removed);
		const moved = gone && came && gone.removed === came.inserted ? source(gone) : null;
		if (moved && came) pending.push({ pos: onScreen(came.fromB), text: came.inserted, moved });
	}
}

/**
 * The edits about to be saved, with each waiting paste written on the edit
 * that holds it — and the waiting over, saved or not: a paste that did not
 * fit any edit is the person's words, as any insertion is.
 */
export function take<E extends Edit & { fromB: number; toB: number }>(edits: E[]): E[] {
	for (const p of pending) {
		const holder = edits.find((e) => !e.moved && e.fromB <= p.pos && p.pos + p.text.length <= e.toB);
		if (holder) holder.moved = p.moved;
	}
	pending = [];
	return edits;
}

/** Another note, or none: what was waiting was about a text that is gone from the screen. The cut itself is kept. */
export function forget(): void {
	pending = [];
}
