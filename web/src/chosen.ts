/**
 * The words chosen in the editor — or in a PDF's tab — right now.
 *
 * Choosing is how a person points: the box above pi's column shows what is
 * chosen, and a question sent while it is chosen goes with it, so "what does
 * this mean" is a question about something. Nothing is sent until a question
 * is, and nothing is stored — this is the selection, held where the composer
 * can see it, which is the one thing a CodeMirror in another column cannot do
 * by being asked.
 *
 * Cursor attaches the same way: what is open and what is chosen ride along
 * with the message rather than waiting for a key.
 */
import { createStore } from "./serverState.ts";

/** Long enough to point with; a whole note chosen is a note pi can read itself. */
export const LIMIT = 2000;

/**
 * `page` is where in a document the words are — "3", or "3-4" when they run
 * over a page's end — and absent for a note, whose words pi finds by reading.
 * A PDF's pages are the only address its words have.
 */
export type Chosen = { path: string; text: string; page?: string };

export const chosenStore = createStore<Chosen | null>(null);

/** What the editor points at, or nothing when the selection is empty or only space. */
export function choose(path: string, text: string, page?: string): void {
	const words = text.trim();
	const now = chosenStore.get();
	if (!words) {
		if (now) chosenStore.set(null);
		return;
	}
	const cut = words.length > LIMIT ? `${words.slice(0, LIMIT)}…` : words;
	if (now?.path === path && now.text === cut && now.page === page) return;
	chosenStore.set(page ? { path, text: cut, page } : { path, text: cut });
}
