/**
 * Whether the markdown in front is being read or written.
 *
 * Two states, as Obsidian has them, and the same file in both: reading hides
 * the markup and refuses every change (livePreview.ts), writing is the editor
 * as it has always been. ⌘E is the way across.
 *
 * How a file opens is a guess about why it is in front. A spec's three
 * documents are the agent's writing put there to be judged — read, approved,
 * and only then corrected — so they open read; the corrections are a keystroke
 * away. Everything else is a note, which is somewhere a person writes, and it
 * opens where it always did. The folder cannot tell a repository's README from
 * a note of your own — to the server both are notes, with a log and backlinks —
 * so the line is drawn where the app can actually see it.
 *
 * What is chosen is kept for as long as the window is and written nowhere: the
 * mode is how a file is being looked at now, not something true of the file,
 * and a mode remembered from last week is a file that opens wrong. A renamed
 * file loses its choice and opens as its kind does, which is the same answer.
 *
 * Pure but for the store, like runOn.ts; the stores are read where they are drawn.
 */
import { isSpec } from "../../documentKinds.ts";
import { createStore } from "./serverState.ts";

export type Mode = "read" | "edit";

/** How a file opens when nobody has said otherwise. */
export const defaultMode = (path: string): Mode => (isSpec(path) ? "read" : "edit");

const store = createStore<ReadonlyMap<string, Mode>>(new Map());

export const modeStore = { get: store.get, subscribe: store.subscribe };

/** The mode a path is in: what was chosen for it in this window, else how it opens. Nothing in front is written in nowhere. */
export const modeOf = (chosen: ReadonlyMap<string, Mode>, path: string | null): Mode => (path === null ? "edit" : (chosen.get(path) ?? defaultMode(path)));

/** The other mode. */
export const other = (mode: Mode): Mode => (mode === "read" ? "edit" : "read");

/**
 * Put `path` in `mode`. A choice that agrees with how the file opens is still
 * kept: the answer is the same either way, and a Map that forgets what was
 * chosen would need the caller to know the default to clear it.
 */
export function chooseMode(path: string, mode: Mode): void {
	const was = store.get();
	if (was.get(path) === mode) return;
	const next = new Map(was);
	next.set(path, mode);
	store.set(next);
}

/** ⌘E and the toggle in the header: the file in front, in the other mode. Nothing in front, nothing to switch. */
export function switchMode(path: string | null): void {
	if (path !== null) chooseMode(path, other(modeOf(store.get(), path)));
}
