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
import { useState, useSyncExternalStore } from "react";

import { inFrontStore, type Saved } from "../inFront";
import { Button } from "./ui/button";

/**
 * An item in the strip that can be pressed.
 *
 * shadcn's ghost button, which is where `hover:bg-accent` is written down —
 * the same token the tabs use for the same gesture (NoteTabs.tsx), so pointing
 * at something down here feels like pointing at something up there. A button
 * rather than a span with a handler: the keyboard and the focus ring come with
 * it, and neither is worth writing again.
 *
 * `cursor-default`, as everywhere else in this window. This is an app, and the
 * hand that means "this is a link to somewhere else on the web" is not what a
 * word count is.
 */
function Item({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
	return (
		<Button variant="ghost" size="xs" className="h-5 cursor-default px-1.5 font-normal" title={title} onClick={onClick}>
			{children}
		</Button>
	);
}

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
	// Which of the two the count is showing. Held here rather than beside the
	// note: it is how you like to be told, not a fact about any one note, so it
	// stays put as you move between them.
	const [counting, setCounting] = useState<"words" | "characters">("words");

	// Only ever about the note that is open. While one note is swapped for
	// another there is a moment when what was last written here is the note
	// being left behind, and the foot of the window is not the place to learn
	// about a note you have just closed.
	const note = front && front.path === path && front.saved !== "loading" ? front : null;

	return (
		<div id="status" className="flex h-7 shrink-0 items-center gap-1 px-1.5 text-xs text-muted-foreground">
			{/* The left is where the note sits in the vault, the right is how it
			    stands now — the order every status bar uses, and the reason this
			    is a spacer rather than `justify-between`: what goes on the left
			    is not here yet. */}
			<div className="flex-1" />
			{note && (
				<Item
					title={counting === "words" ? "Count characters instead" : "Count words instead"}
					onClick={() => setCounting((was) => (was === "words" ? "characters" : "words"))}
				>
					<span id="count" data-counting={counting}>
						{note[counting].toLocaleString()} {counting === "words" ? (note.words === 1 ? "word" : "words") : note.characters === 1 ? "character" : "characters"}
					</span>
				</Item>
			)}
			{note && <span data-saved={note.saved} className="px-1.5">{words[note.saved]}</span>}
		</div>
	);
}
