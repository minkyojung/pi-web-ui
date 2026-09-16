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

/** Where the note on screen stands with the copy on disk. See Editor.tsx. */
export type Saved = "loading" | "saved" | "unsaved" | "conflict" | "gone";

export type InFront = {
	path: string;
	saved: Saved;
};

export const inFrontStore = createStore<InFront | null>(null);
