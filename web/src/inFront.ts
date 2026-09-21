/**
 * What the strip under the page says about the note in front.
 *
 * The strip is not in the editor — it is a rule across the foot of the window,
 * under the note and pi both (App.tsx) — but most of what it has to say is the
 * editor's to know: whether what is on screen has reached the disk, how many
 * words there are, which tags the text carries. None of that is on the server
 * and none of it is worth passing down through three resizable panels, so the
 * editor writes it here and the strip reads it. A view of this window, not of
 * the note, the way showAuthorsStore is (features/authors.ts).
 *
 * The path comes with it. Two editors exist for a moment while one note is
 * swapped for another, and a strip that read whatever was written last would
 * show the note being left behind as the note in front: the strip draws
 * nothing unless the path it was told is the path that is open.
 */
import { createStore } from "./serverState";
import type { Authored } from "../../protocol.ts";

/** Where the note on screen stands with the copy on disk. See Editor.tsx. */
export type Saved = "loading" | "saved" | "unsaved" | "conflict" | "gone";

export type InFront = {
	path: string;
	saved: Saved;
	/** The body's words and characters — the front matter is the note's about, not the note. */
	words: number;
	characters: number;
	/** The note's own tags, as the vault last read them. Written in the note or named in its `tags` property, alike (links.ts). */
	tags: string[];
	/** How much of it somebody other than you wrote, as the note was last written down. See Authored in protocol.ts. */
	authored: Authored | null;
	/**
	 * Which line the cursor is on, for a file being read (Code.tsx) — what
	 * "open this in my editor" opens it at. Absent for a note, whose editor
	 * is this one and which nothing asks this of.
	 */
	line?: number;
};

const nothing = { saved: "loading" as Saved, words: 0, characters: 0, tags: [] as string[], authored: null };

export const inFrontStore = createStore<InFront | null>(null);

/**
 * Say one thing about the note in front, leaving the rest as it was.
 *
 * Two places write here — the save state from a React effect, the counts from
 * the editor's update listener — and neither knows what the other last said.
 * A whole value from either would wipe the other's, and the strip would flicker
 * between half-truths at every keystroke.
 *
 * A different path is a different note, so what was there is dropped rather
 * than merged: a note's word count is not a starting point for the next one's.
 */
export function say(path: string, what: Partial<Omit<InFront, "path">>) {
	const was = inFrontStore.get();
	inFrontStore.set({ ...(was?.path === path ? was : nothing), ...what, path });
}
