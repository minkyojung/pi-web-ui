/**
 * How far down each spec's list of results the person has looked: the last
 * commit that was on it when they opened it, by spec.
 *
 * Kept in the window, as the tabs and the recent list are — it is a fact
 * about this person at this window, not about the repository, and the server
 * is told nothing of it. A commit rather than a count: resultsList.ts says
 * why, and what becomes of one that is no longer there.
 *
 * Read and written as a whole map. It holds a handful of names.
 */
import { createStore } from "./serverState.ts";
import { keyFor } from "./workspace.ts";

const KEY = () => keyFor("seen-results");

/** What is stored, read: a map of spec name to commit, or empty for anything else found there. */
export function readSeen(raw: string | null): Record<string, string> {
	try {
		const found = JSON.parse(raw ?? "{}");
		if (!found || typeof found !== "object" || Array.isArray(found)) return {};
		return Object.fromEntries(Object.entries(found).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
	} catch {
		return {};
	}
}

function stored(): Record<string, string> {
	try {
		return readSeen(localStorage.getItem(KEY()));
	} catch {
		return {};
	}
}

const store = createStore<Record<string, string>>(typeof localStorage === "undefined" ? {} : stored(), { window: true });

/** The window moved to another workspace: what was read there is read under its own key (switch.ts). */
export const reloadSeen = (): void => store.set(stored());

export const seenStore = { get: store.get, subscribe: store.subscribe };

/** `spec`'s list has been looked at as far as `commit`. */
export function sawResults(spec: string, commit: string): void {
	if (store.get()[spec] === commit) return;
	const next = { ...store.get(), [spec]: commit };
	store.set(next);
	try {
		localStorage.setItem(KEY(), JSON.stringify(next));
	} catch {
		// A window with storage blocked forgets, which is all that is lost.
	}
}
