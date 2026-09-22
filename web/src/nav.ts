/**
 * Where you have been, so you can go back — and, having gone back, forward.
 *
 * One list for the window, not one per tab. A tab here is a note rather than
 * a place notes are shown in: opening one always adds a tab and never
 * replaces the note in an existing one, so a list per tab would be a single
 * entry long with nowhere to go. VS Code's tabs are the same shape and its
 * history is the same one list, and going back there brings another tab to
 * the front, as it does here.
 *
 * The list is ours rather than the browser's because the browser will not say
 * whether there is anywhere to go back to — there is no canGoBack — and an
 * arrow has to be drawn either lit or not.
 *
 * The rule that matters, and the one this kind of thing is usually got wrong
 * on: going back removes nothing, and opening something new after going back
 * throws away what was ahead. That is what makes forward mean "the way I
 * came" rather than "somewhere I once was".
 */
import type { Place } from "../../links.ts";
import { keyFor } from "./workspace.ts";

/** Where a note was being read: the cursor, and how far down the page was. */
export type Left = { anchor: number; head: number; scrollTop: number };

/**
 * A note, where in it the link that led there pointed, and where it was being
 * read when it was stepped off.
 *
 * `id` names the step for as long as the window is open, which is what the
 * editor is handed and what it writes its place back to. Positions belong to
 * the step rather than to the note: the same note can stand in the list twice,
 * read at the top in one and at the end in another, and a step back to either
 * should land where that reading was. `id` is not kept — a step means nothing
 * to the next window, only its place does.
 */
export type Entry = { id: number; path: string; place?: Place; left?: Left };

/** The entries, oldest first, and which one is being shown. `at` is -1 only when there are none. */
export type Nav = { entries: Entry[]; at: number };

export const empty: Nav = { entries: [], at: -1 };

/** How far back it is worth being able to go. Chrome keeps 50 a tab; so does VS Code. */
const KEEP = 50;

const KEY = () => keyFor("nav-history");

let nextId = 1;

/** A place is only its heading or its block: a link carries more, and none of the rest is somewhere to land. */
const entryOf = (path: string, place?: Place | null): Entry =>
	place && (place.heading || place.block)
		? { id: nextId++, path, place: { heading: place.heading, block: place.block } }
		: { id: nextId++, path };

/**
 * A note opened rather than come back to opens where it was last read, as in
 * Obsidian — and the list is what knows where that was: the newest step that
 * was in it. A step ahead counts, since it is where the note was read most
 * recently even though it is about to be thrown away.
 */
function asLastRead(entries: Entry[], entry: Entry): Entry {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].path === entry.path && entries[i].left) return { ...entry, left: entries[i].left };
	}
	return entry;
}

const same = (a: Entry | undefined, b: Entry): boolean =>
	a !== undefined && a.path === b.path && (a.place?.heading ?? null) === (b.place?.heading ?? null) && (a.place?.block ?? null) === (b.place?.block ?? null);

/** What is being shown, or null with nothing in the list. */
export const here = (nav: Nav): Entry | null => nav.entries[nav.at] ?? null;

export const canBack = (nav: Nav): boolean => nav.at > 0;
export const canForward = (nav: Nav): boolean => nav.at < nav.entries.length - 1;

/**
 * A note opened. Everything ahead of where we stand is thrown away, and the
 * note goes on the end.
 *
 * Opening what is already in front is not going anywhere: the list comes back
 * unchanged, reference and all, so nothing downstream has to notice.
 */
export function go(nav: Nav, path: string, place?: Place | null): Nav {
	const entry = entryOf(path, place);
	if (same(here(nav) ?? undefined, entry)) return nav;
	const kept = nav.entries.slice(0, nav.at + 1);
	return { entries: [...kept, asLastRead(nav.entries, entry)].slice(-KEEP), at: Math.min(kept.length, KEEP - 1) };
}

/** One step back, or the list as it is if there is nowhere to go. */
export const back = (nav: Nav): Nav => (canBack(nav) ? { ...nav, at: nav.at - 1 } : nav);

/** One step forward, or the list as it is. */
export const forward = (nav: Nav): Nav => (canForward(nav) ? { ...nav, at: nav.at + 1 } : nav);

/**
 * The note in front changed without anyone going anywhere — a tab closed, and
 * its neighbour came forward. The entry we stand on becomes that note instead
 * of a new one being added: closing a tab is not a destination, and a step
 * back right afterwards should reach what came before the tab, not reopen it.
 *
 * The neighbour that comes forward is usually the one we came from, which
 * would leave the same note twice in a row and a step back that changes
 * nothing on screen. So a repeat is folded into the entry it repeats, and we
 * stand on that one.
 */
export function replace(nav: Nav, path: string, place?: Place | null): Nav {
	const entry = entryOf(path, place);
	if (nav.at === -1) return go(nav, path, place);
	if (same(nav.entries[nav.at], entry)) return nav;
	const entries = nav.entries.slice();
	entries[nav.at] = asLastRead(nav.entries, entry);
	let at = nav.at;
	if (same(entries[at - 1], entry)) entries.splice(at--, 1);
	else if (same(entries[at + 1], entry)) entries.splice(at, 1);
	return { entries, at };
}

/** Where the note was being read when the step named by `id` was stepped off. A step no longer in the list is nobody's business. */
export function remember(nav: Nav, id: number, left: Left): Nav {
	const at = nav.entries.findIndex((e) => e.id === id);
	if (at === -1) return nav;
	const entries = nav.entries.slice();
	entries[at] = { ...entries[at], left };
	return { entries, at: nav.at };
}

/**
 * A rename or a delete, as in recent.ts: the old path is followed to its new
 * name, or dropped where there is none.
 *
 * Dropping can leave the same note twice in a row — a, b, a with b gone — and
 * two steps to stand still is not a step, so a repeat is folded into the one
 * before it. Where we stand moves with the entry it was on; if that entry is
 * one of the dropped, it falls back to the nearest kept one before it.
 */
export function forget(nav: Nav, path: string, replacement?: string): Nav {
	const entries: Entry[] = [];
	let at = -1;
	for (let i = 0; i < nav.entries.length; i++) {
		const was = nav.entries[i];
		const entry = was.path !== path ? was : replacement ? { ...was, path: replacement } : null;
		if (entry && !same(entries[entries.length - 1], entry)) entries.push(entry);
		if (i <= nav.at) at = entries.length - 1;
	}
	return { entries, at: entries.length === 0 ? -1 : Math.max(at, 0) };
}

/** A place as it comes back from storage, with anything that is not a number in it dropped. */
function leftOf(raw: unknown): Left | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const { anchor, head, scrollTop } = raw as Left;
	if (![anchor, head, scrollTop].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return undefined;
	return { anchor, head, scrollTop };
}

/** A place as it comes back from storage, with anything that is not a name in it dropped. */
function placeOf(raw: unknown): Place | null {
	if (typeof raw !== "object" || raw === null) return null;
	const { heading, block } = raw as Place;
	return { heading: typeof heading === "string" ? heading : null, block: typeof block === "string" ? block : null };
}

/**
 * The list read back from what was kept, or an empty one if that is not a
 * list this wrote — it is a convenience, and losing it costs nothing.
 *
 * The step landed on comes back without the place a link pointed at: a reload
 * should not jump the cursor to where a link once did. It keeps where it was
 * being read, which is where the note opens again. The steps around it keep
 * both, since going back to one is following that link again.
 */
export function restored(raw: unknown): Nav {
	if (typeof raw !== "object" || raw === null) return empty;
	const { entries, at } = raw as { entries?: unknown; at?: unknown };
	if (!Array.isArray(entries) || entries.length === 0 || !Number.isInteger(at)) return empty;
	const kept: Entry[] = [];
	for (const was of entries) {
		const path = (was as Entry)?.path;
		if (typeof path !== "string") return empty;
		const entry = entryOf(path, placeOf((was as Entry).place));
		const left = leftOf((was as Entry).left);
		kept.push(left ? { ...entry, left } : entry);
	}
	const where = (at as number) >= 0 && (at as number) < kept.length ? (at as number) : kept.length - 1;
	kept[where] = { id: kept[where].id, path: kept[where].path, ...(kept[where].left ? { left: kept[where].left } : {}) };
	return { entries: kept, at: where };
}

export function read(): Nav {
	try {
		return restored(JSON.parse(localStorage.getItem(KEY()) ?? "null"));
	} catch {
		return empty;
	}
}

export function write(nav: Nav): void {
	try {
		localStorage.setItem(KEY(), JSON.stringify(nav));
	} catch {
		// A window with storage blocked opens with no way back, which is all that is lost.
	}
}
