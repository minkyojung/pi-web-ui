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
 *
 * Its height is the one the window's other chrome rows have — the strip the
 * tabs sit in, the strip over the list, pi's own header — because it is one of
 * them. Nothing else here is a height: the items are shadcn buttons at `sm`,
 * and the gap between them and the edge of the strip is what is left over,
 * which is the same gap a tab has at the top. Numbers matched by eye drift the
 * moment either end is touched; numbers that follow from one another do not.
 *
 * Left is where the note sits among the others — its tags.
 * Right is how it stands right now — how much of it there is, whether it has
 * reached the disk. That is the order every status bar uses, and it is worth
 * keeping: the left changes when you file something, the right while you type.
 *
 * All of that is the note's half, which is as wide as the note's column. What
 * pi has to say for itself is the other half, under pi — see AgentStatus.
 */
import { useSyncExternalStore, useState } from "react";

import { inFrontStore, type Saved } from "../inFront";
import type { Authored } from "../../../protocol.ts";
import { taggedStore } from "../serverState";
import { titleOf } from "../noteSync";
import type { Backlink, Tagged } from "../types";
import { AgentStatus } from "./AgentStatus";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * An item in the strip that can be pressed.
 *
 * shadcn's ghost button, which is where `hover:bg-accent` is written down —
 * the same token the tabs use for the same gesture (NoteTabs.tsx), so pointing
 * at something down here feels like pointing at something up there. A button
 * rather than a span with a handler: the keyboard and the focus ring come with
 * it, and neither is worth writing again.
 *
 * `size` decides how tall it is, and nothing here overrides it. `text-xs` is
 * overridden, and is the one thing that should be: how tall a control is comes
 * from the scale the buttons are cut to, while how loud it reads is this
 * strip's own business — a status bar is quieter than a row of tabs in every
 * app that has both. That is the
 * whole of how the tabs are built too: the row says how tall the row is, the
 * track says how tall the band of tabs is, and a tab itself declares no height
 * at all. A `className="h-7"` on each item would be the same number written
 * out once per item, off the scale the buttons are cut to — 24, 32, 36 — and
 * the gap between the item and the edge of the strip would then be a thing
 * somebody had matched by eye rather than a thing that follows.
 *
 * `cursor-default`, as everywhere else in this window. This is an app, and the
 * hand that means "this is a link to somewhere else on the web" is not what a
 * word count is.
 */
function Item({ onClick, title, children }: { onClick?: () => void; title?: string; children: React.ReactNode }) {
	return (
		<Button variant="ghost" size="sm" className="cursor-default px-1.5 text-xs font-normal" title={title} onClick={onClick}>
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
 * Nothing once it is there, either. A note is on disk almost always, and a word
 * that is drawn almost always is read as part of the strip rather than as
 * something the strip is saying — which leaves nothing louder for the moment it
 * is not true. VS Code and Zed say nothing for a saved file too; the row of
 * tabs is where a file that is behind says so, and this window has one.
 *
 * "Saving" rather than "Unsaved" for work that has been typed and not yet
 * sent. It is a second away and nobody has to do anything about it, and the
 * word for a thing in hand should not be the word for a thing gone wrong —
 * those two are `conflict` and `gone`, and they say so plainly.
 */
/** Where the choice of words or characters is kept, beside the recent list and the tabs. */
const COUNTING = "status-counting";

const words: Record<Saved, string | null> = {
	loading: null,
	saved: null,
	unsaved: "Saving",
	conflict: "Not saved",
	gone: "Not on disk",
};

/**
 * The notes the vault puts beside this one — a count in the strip, the list
 * itself behind it.
 *
 * A count and not the list, because the strip is one line and a note can be
 * pointed at by twenty others. It used to be the list, drawn under the note,
 * and that is what made the page move: a strip that holds however many there
 * happen to be is a strip with no height of its own. Linear folds its labels
 * to `+3` for the same reason.
 *
 * A popover rather than a panel, since this is a thing you glance at and put
 * away again. It is the note's own list, so it closes when you take one: you
 * asked to go somewhere, and what is behind you is not worth leaving open.
 */
function Related({
	id,
	what,
	notes,
	onOpen,
	trigger,
}: {
	id: string;
	what: string;
	notes: (Backlink | Tagged)[];
	onOpen?: (path: string) => void;
	/** What opens it, when something other than the count should. */
	trigger?: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	if (notes.length === 0) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				{trigger ?? (
					<Button variant="ghost" size="sm" className="cursor-default px-1.5 text-xs font-normal" data-count={notes.length}>
						{notes.length} {what}
					</Button>
				)}
			</PopoverTrigger>
			<PopoverContent id={id} align="start" side="top" className="max-h-72 w-64 overflow-y-auto p-1">
				{notes.map((note) => (
					<Button
						key={note.path}
						variant="ghost"
						size="xs"
						data-path={note.path}
						title={note.path}
						className="h-6 w-full cursor-default justify-start gap-2 px-2 font-normal"
						onClick={() => {
							setOpen(false);
							onOpen?.(note.path);
						}}
					>
						<span className="truncate">{titleOf(note.path)}</span>
						{/* Why it is on this list: the tags shared, or how many times
						    the other note names this one. Nothing for a single mention,
						    which the row already says by being there. */}
						<span className="ml-auto shrink-0 text-muted-foreground">
							{"tags" in note ? note.tags.map((tag) => `#${tag}`).join(" ") : note.count > 1 ? note.count : ""}
						</span>
					</Button>
				))}
			</PopoverContent>
		</Popover>
	);
}

/**
 * How much of the note is not the reader's own, in words rather than a figure.
 *
 * Nothing at all when it is all theirs, which is most notes. A `0%` on every
 * note in the vault is a scoreboard nobody asked for, and the number people
 * would then keep an eye on is not one this app has an opinion about.
 *
 * Rounded to whole points and never past 99 while any of it is somebody
 * else's: the marks widen to take in a word typed into the middle of a run
 * until the next answer splits it (features/authors.ts), so the last point is
 * not one this can stand behind. A share of "100%" on a note you have just
 * added a line to would be a plain lie.
 *
 * pi and outside are counted apart. A note a quarter of which came from a sync
 * client is not the same note as one a quarter written by pi, and rolling them
 * together into "not yours" would lose the only part anybody acts on.
 */
function share(of: Authored): { agent: string | null; other: string | null; title: string } | null {
	if (of.total === 0 || (of.pi === 0 && of.other === 0)) return null;
	const cut = (n: number) => (n === 0 ? null : `${Math.min(99, Math.max(1, Math.round((n / of.total) * 100)))}%`);
	const agent = cut(of.pi);
	const other = cut(of.other);
	return {
		agent,
		other,
		title: [agent && `the agent wrote ${agent} of this note`, other && `${other} was written outside Octave`].filter(Boolean).join(" · "),
	};
}

/**
 * One of the note's tags, and the other notes that carry it.
 *
 * Pressing it asks the vault, not the search box. A search is over the words
 * of a note, and a tag named in a note's `tags` property is nowhere in its
 * words: `#agent` typed into the search would find the notes that spell it out
 * and quietly miss the ones that file themselves under it. The index already
 * holds the right answer and the strip already has it (taggedStore).
 *
 * Nothing opens when this is the only note with it. Somewhere to go and
 * nowhere to go should not look the same, so a tag no other note shares is
 * drawn as what it is — a word, not a way through.
 */
function Tag({ name, notes, onOpen }: { name: string; notes: Tagged[]; onOpen?: (path: string) => void }) {
	if (notes.length === 0) return <span className="shrink-0 px-1.5">#{name}</span>;
	return (
		<Related
			id={`tag-${name}`}
			what={name}
			notes={notes}
			onOpen={onOpen}
			trigger={
				<Button variant="ghost" size="sm" className="shrink-0 cursor-default px-1.5 text-xs font-normal" data-tag={name} title={`${notes.length} other ${notes.length === 1 ? "note has" : "notes have"} #${name}`}>
					#{name}
				</Button>
			}
		/>
	);
}

export function StatusBar({ path, onOpen, piWidth, piFolded, onUnfoldPi }: { path: string | null; onOpen?: (path: string) => void; piWidth: number | null; piFolded: boolean; onUnfoldPi: () => void }) {
	const front = useSyncExternalStore(inFrontStore.subscribe, inFrontStore.get);
	const tagged = useSyncExternalStore(taggedStore.subscribe, taggedStore.get);
	// Which of the two the count is showing. Not beside the note — it is how you
	// like to be told, not a fact about any one note — and kept in this browser,
	// the way the recent list and the row of tabs are: a choice you made once
	// and would have to make again at every launch is not a choice, it is a
	// chore. Words to begin with, which is what a note is usually measured in.
	const [counting, setCounting] = useState<"words" | "characters">(() =>
		(() => {
			try {
				return localStorage.getItem(COUNTING) === "characters" ? "characters" : "words";
			} catch {
				return "words";
			}
		})(),
	);
	const count = (want: "words" | "characters") => {
		setCounting(want);
		try {
			localStorage.setItem(COUNTING, want);
		} catch {
			// A browser that will not keep it still counts; it just forgets which way.
		}
	};

	// Only ever about the note that is open. While one note is swapped for
	// another there is a moment when what was last written here is the note
	// being left behind, and the foot of the window is not the place to learn
	// about a note you have just closed.
	const note = front && front.path === path && front.saved !== "loading" ? front : null;
	const hand = note?.authored ? share(note.authored) : null;
	const shares = path ? (tagged[path] ?? []) : [];

	return (
		<div id="status" className="flex h-11 shrink-0 items-center px-2 text-xs text-muted-foreground">
			{/* The note's half. It has no width of its own: it is what the strip
			    has left once pi's half has taken pi's width, which is how the two
			    halves come to be laid under the two columns without either being
			    told where the divider is. No gap between them for the same reason
			    — a gap here would be width that belongs to neither. */}
			<div id="note-status" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
				{/* Truncated rather than wrapped or counted off as `+3`. A note with
				    twenty tags is rare and a strip that changed height for it would
				    undo the whole of this; clipping the end keeps the rule where it
				    is and says how many there are by saying nothing about the rest. */}
				<div id="tags" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
					{note?.tags.map((tag) => (
						<Tag key={tag} name={tag} notes={shares.filter((other) => other.tags.includes(tag))} onOpen={onOpen} />
					))}
				</div>
				{hand && (
					<span id="authored" className="px-1.5" title={hand.title} data-agent={hand.agent ?? undefined} data-other={hand.other ?? undefined}>
						{hand.agent && <span>agent {hand.agent}</span>}
						{hand.agent && hand.other && " · "}
						{hand.other && <span>outside {hand.other}</span>}
					</span>
				)}
				<div className="flex-1" />
				{note && (
					<Item
						title={counting === "words" ? "Count characters instead" : "Count words instead"}
						onClick={() => count(counting === "words" ? "characters" : "words")}
					>
						<span id="count" data-counting={counting}>
							{note[counting].toLocaleString()} {counting === "words" ? (note.words === 1 ? "word" : "words") : note.characters === 1 ? "character" : "characters"}
						</span>
					</Item>
				)}
				{note && (
					<span data-saved={note.saved} className="px-1.5">
						{words[note.saved]}
					</span>
				)}
			</div>
			<AgentStatus width={piWidth} folded={piFolded} onUnfold={onUnfoldPi} />
		</div>
	);
}
