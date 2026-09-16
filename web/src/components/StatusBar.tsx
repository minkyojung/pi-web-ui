/**
 * A rule across the foot of the window, under the note and pi both.
 *
 * The window already has one of these at the top — the strip the tabs sit in,
 * whose height the columns keep clear for it (App.tsx) — and this is its pair
 * at the bottom. It is a status bar in the sense VS Code, Zed and Xcode mean:
 * part of the window rather than a panel in it, so it cannot be resized,
 * collapsed or scrolled, and its height never changes.
 *
 * That last part is the whole of why it is here. What the vault knows about a
 * note used to be drawn inside the page, which meant it appeared the moment a
 * note was given a tag and moved whenever the text grew — a page that jumps
 * under the hand that is writing on it. A bar of its own, always the same
 * height, cannot do that.
 *
 * The bar is always there; what is in it is not. A note with no tags and
 * nothing pointing at it simply has less to say, the way VS Code shows a git
 * branch only in a repository. Items come and go, the rule does not move.
 */
import { useSyncExternalStore } from "react";

import { inFrontStore, type Saved } from "../inFront";

/**
 * What the note on screen has to do with the copy on disk, in words.
 *
 * Nothing while it is still arriving: a bar that says "Opening…" for the
 * tenth of a second a note takes to come is a flicker, not an answer.
 *
 * "Saving" rather than "Unsaved" for work that has been typed and not yet
 * sent. It is a second away and nobody has to do anything about it, and the
 * word for a thing in hand should not be the word for a thing gone wrong —
 * those two are `conflict` and `gone`, and they say so plainly.
 */
const words: Record<Saved, string | null> = {
	loading: null,
	saved: "Saved",
	unsaved: "Saving",
	conflict: "Not saved",
	gone: "Not on disk",
};

export function StatusBar({ path }: { path: string | null }) {
	const front = useSyncExternalStore(inFrontStore.subscribe, inFrontStore.get);
	// Only ever about the note that is open. While one note is swapped for
	// another there is a moment when what was last written here is the note
	// being left behind, and the foot of the window is not the place to learn
	// about a note you have just closed.
	const saved = front && front.path === path ? words[front.saved] : null;

	return (
		<div id="status" className="flex h-7 shrink-0 items-center gap-3 px-3 text-xs text-muted-foreground">
			{/* The left is where the note sits in the vault, the right is how it
			    stands now — the order every status bar uses, and the reason this
			    is a spacer rather than `justify-between`: what goes on the left
			    is not here yet. */}
			<div className="flex-1" />
			{saved && <span data-saved={front?.saved}>{saved}</span>}
		</div>
	);
}
