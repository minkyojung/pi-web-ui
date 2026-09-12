/**
 * The cards in a note's margin: what was asked about a part of a note, and
 * what came back.
 *
 * A card is not in the note. The note stays plain markdown that any editor can
 * read; the cards live beside it under .pi/, one append-only log per note,
 * replayed into the cards the way a note's history is replayed into its text.
 * Notion and Google Docs keep comments this way too — anchored to a range,
 * held outside the document, resolved rather than deleted.
 *
 * What anchors a card is where it was opened plus how long the note's log was
 * at that moment. Everything appended to that log since is what the note did
 * afterwards, so mapping the place through it says where the words are now;
 * when the two ends meet, the words are gone and the card has nothing left to
 * point at.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AskOutcome } from "./ask.ts";
import { type Change, mapThrough, readHistory } from "./history.ts";

/** Why a card has no answer. An ask that ended any way but `written`. */
export type CardFailure = Exclude<AskOutcome, "written">;

/** One line of a note's card log. Everything a card is, is one of these having happened. */
export type CardEvent =
	| {
			kind: "opened";
			id: string;
			at: number;
			/** The chosen words, in the note as it was when they were chosen. */
			from: number;
			to: number;
			/** How many changes the note's history held then. The mark places are measured from. */
			log: number;
			quote: string;
			question: string;
	  }
	| { kind: "answered"; id: string; at: number; text: string; sessionId: string; entryId?: string }
	| { kind: "failed"; id: string; at: number; why: CardFailure }
	| { kind: "placed"; id: string; at: number }
	| { kind: "resolved"; id: string; at: number }
	| { kind: "deleted"; id: string; at: number };

/** A card as it now stands, with `from` and `to` in the note as it is now. */
export type Card = {
	id: string;
	at: number;
	from: number;
	to: number;
	quote: string;
	question: string;
	answer?: { text: string; sessionId: string; entryId?: string; at: number };
	/** Why there is no answer, when the run ended without one. */
	failed?: CardFailure;
	/** The answer has been put into the note, and is pi's words there. */
	placed?: true;
	/** Answered and done with: kept, not shown. */
	resolved?: true;
	/** The words it was opened on are gone, so `from` and `to` meet. */
	orphaned?: true;
};

/** A card and the mark its place is measured from. */
type Anchored = Card & { log: number };

/**
 * The cards the log's lines make, before their places are moved.
 *
 * A line about a card that was never opened, or was opened and then deleted,
 * is about nothing and is passed over: the log is appended to by one writer,
 * but it outlives the tabs that wrote it, and a card deleted in one tab can be
 * resolved in another that had not heard yet.
 */
function replay(events: CardEvent[]): Anchored[] {
	const open = new Map<string, Anchored>();
	for (const event of events) {
		if (event.kind === "opened") {
			const { kind: _kind, ...card } = event;
			open.set(event.id, card);
			continue;
		}
		const card = open.get(event.id);
		if (!card) continue;
		switch (event.kind) {
			case "answered":
				card.answer = { text: event.text, sessionId: event.sessionId, entryId: event.entryId, at: event.at };
				delete card.failed;
				break;
			case "failed":
				card.failed = event.why;
				break;
			case "placed":
				card.placed = true;
				break;
			case "resolved":
				card.resolved = true;
				break;
			case "deleted":
				open.delete(event.id);
				break;
		}
	}
	return [...open.values()];
}

/**
 * The cards as they now sit in the note, `changes` being the note's whole
 * history. In the order they are read in — down the note, and by age where
 * two sit at the same place.
 */
export function cardsIn(events: CardEvent[], changes: Change[]): Card[] {
	const cards = replay(events).map(({ log, ...card }) => {
		const since = changes.slice(log);
		const from = mapThrough(since, card.from);
		const to = mapThrough(since, card.to);
		return { ...card, from, to, ...(from >= to ? { orphaned: true as const } : {}) };
	});
	return cards.sort((a, b) => a.from - b.from || a.at - b.at);
}

// ---------------------------------------------------------------------------
// On disk

export const CARDS_DIR = ".pi/cards";

/** `.pi/cards/<note path>.jsonl`, keeping the note's own folders, as the history does. */
export function cardsPath(root: string, path: string): string {
	return join(root, CARDS_DIR, `${path}.jsonl`);
}

/** A trashed note's cards wait in the trash beside it, under the name it was trashed as. */
export function trashCardsPath(root: string, trashed: string): string {
	return join(root, ".pi", "trash", "cards", `${trashed}.jsonl`);
}

export function readCardLog(root: string, path: string): CardEvent[] {
	const file = cardsPath(root, path);
	if (!existsSync(file)) return [];
	const out: CardEvent[] = [];
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

export function appendCard(root: string, path: string, event: CardEvent): void {
	const file = cardsPath(root, path);
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, JSON.stringify(event) + "\n");
}

/** A note's cards, where they now sit in it. */
export function cardsOf(root: string, path: string): Card[] {
	return cardsIn(readCardLog(root, path), readHistory(root, path));
}
