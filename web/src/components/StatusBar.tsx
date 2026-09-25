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
 * Against the left edge, after what the spec's tasks have come to, two things
 * about the note as it stands: how much of it there is, and how much of it the agent wrote — then
 * whether it has reached the disk, only when it has not. Where the note sits among
 * the others, its tags and what links to it, was here once and is not the
 * strip's to say: those are ways to go somewhere, and this is a place to read.
 *
 * All of that is the note's half, which is as wide as the note's column. What
 * pi has to say for itself is the other half, under pi — see AgentStatus.
 */
import { useSyncExternalStore, useState } from "react";

import { isSpec } from "../../../documentKinds.ts";
import { showAuthorsStore } from "../features/authors";
import { prefs } from "../prefs.ts";
import { inFrontStore, type Saved } from "../inFront";
import type { Authored } from "../../../protocol.ts";
import { AgentStatus } from "./AgentStatus";
import { BranchStanding } from "./BranchStanding";
import { Scripts } from "./Scripts";
import { TaskResults } from "./TaskResults";
import { Button } from "./ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

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
function share(of: Authored): { agent: string | null; other: string | null } | null {
	if (of.total === 0 || (of.pi === 0 && of.other === 0)) return null;
	const cut = (n: number) => (n === 0 ? null : `${Math.min(99, Math.max(1, Math.round((n / of.total) * 100)))}%`);
	const agent = cut(of.pi);
	const other = cut(of.other);
	return { agent, other };
}

export function StatusBar({ path, piWidth, piFolded, onUnfoldPi, onOpen }: { path: string | null; piWidth: number | null; piFolded: boolean; onUnfoldPi: () => void; onOpen: (path: string) => void }) {
	const front = useSyncExternalStore(inFrontStore.subscribe, inFrontStore.get);
	// Which of the two the count is showing. Not beside the note — it is how you
	// like to be told, not a fact about any one note — and kept with the
	// window, the way the theme is (prefs.ts): a choice you made once and
	// would have to make again at every launch is not a choice, it is a
	// chore. Words to begin with, which is what a note is usually measured in.
	const [counting, setCounting] = useState<"words" | "characters">(() => (prefs.get(COUNTING) === "characters" ? "characters" : "words"));
	const count = (want: "words" | "characters") => {
		setCounting(want);
		prefs.set(COUNTING, want);
	};

	// Only ever about the note that is open. While one note is swapped for
	// another there is a moment when what was last written here is the note
	// being left behind, and the foot of the window is not the place to learn
	// about a note you have just closed.
	const note = front && front.path === path && front.saved !== "loading" ? front : null;
	// A spec is not a note: how many words are in it is not a thing about it
	// worth a place in the bar, any more than its tags or its backlinks are.
	const counted = note && path !== null && !isSpec(path) ? note : null;
	const hand = note?.authored ? share(note.authored) : null;
	const showing = useSyncExternalStore(showAuthorsStore.subscribe, showAuthorsStore.get);

	return (
		<div id="status" className="flex h-11 shrink-0 items-center px-2 text-xs text-muted-foreground">
			{/* The note's half. It has no width of its own: it is what the strip
			    has left once pi's half has taken pi's width, which is how the two
			    halves come to be laid under the two columns without either being
			    told where the divider is. No gap between them for the same reason
			    — a gap here would be width that belongs to neither. */}
			<div id="note-status" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
				{/* First, and whatever is in front: what the spec's tasks have come
				    to is about the work and not about the page being read, and a
				    place that moved with the page would not be one to glance at. */}
				<TaskResults open={path} onOpen={onOpen} />
				{/* All of it against the left edge, where the note's own text begins.
				    The count first, because it is always there: the agent's share is
				    only on the notes it has written in, and coming and going after
				    the count it moves nothing, where before it the count would shift
				    every time a note was opened. */}
				{counted && (
					<Item
						title={counting === "words" ? "Count characters instead" : "Count words instead"}
						onClick={() => count(counting === "words" ? "characters" : "words")}
					>
						<span id="count" data-counting={counting}>
							{counted[counting].toLocaleString()} {counting === "words" ? (counted.words === 1 ? "word" : "words") : counted.characters === 1 ? "character" : "characters"}
						</span>
					</Item>
				)}
				{hand && (
					// The switch for the marks is behind the share rather than on it.
					// The figure already says somebody else wrote some of this, so it
					// is where the question of where comes up — but the strip is a
					// place to read, and a control that stays drawn there, pressed or
					// not, is louder than anything else in it. So it comes up with the
					// pointer, the way the context ring's card does (ContextCard.tsx),
					// and the words on the page are what say it is on.
					<HoverCard openDelay={0} closeDelay={150}>
						<HoverCardTrigger asChild>
							<Button
								id="authored"
								variant="ghost"
								size="sm"
								className="cursor-default px-1.5 text-xs font-normal"
								data-agent={hand.agent ?? undefined}
								data-other={hand.other ?? undefined}
							>
								{hand.agent && <span>agent {hand.agent}</span>}
								{hand.agent && hand.other && " · "}
								{hand.other && <span>outside {hand.other}</span>}
							</Button>
						</HoverCardTrigger>
						<HoverCardContent side="top" align="start" className="flex w-auto items-center justify-between gap-4">
							<div className="flex flex-col gap-0.5">
								<Label htmlFor="whoWrote">Who wrote what</Label>
								<p className="text-xs whitespace-nowrap text-muted-foreground">
									{[hand.agent && "Underlined: the agent", hand.other && "Dashed: outside Octave"].filter(Boolean).join(" · ")}
								</p>
							</div>
							<Switch id="whoWrote" checked={showing} onCheckedChange={(on) => showAuthorsStore.set(on)} />
						</HoverCardContent>
					</HoverCard>
				)}
				{note && (
					<span data-saved={note.saved} className="px-1.5">
						{words[note.saved]}
					</span>
				)}
				{/* At the far end of the note's half, under the note's right edge: what
				    is about the workspace and not the note. The repository's own
				    commands, then where the branch stands last, so commits, the push
				    and the pull request are read in one corner whatever is in front.
				    The group, not either item, takes what is left of the row: Scripts
				    is not there in a repository without a config, and the branch
				    should not slide to the left edge when it is not. */}
				<div className="ml-auto flex shrink-0 items-center gap-0.5">
					<Scripts onOpen={onOpen} />
					<BranchStanding onOpen={onOpen} />
				</div>
			</div>
			<AgentStatus width={piWidth} folded={piFolded} onUnfold={onUnfoldPi} />
		</div>
	);
}
