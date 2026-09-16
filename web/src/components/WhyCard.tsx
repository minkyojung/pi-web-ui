import { useEffect, useSyncExternalStore } from "react";
import { diffWordsWithSpace } from "diff";

import { askedAtStore, putBack } from "../features/authors";
import { configStore, sessionsStore, whyStore } from "../serverState";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle } from "./ui/popover";

/**
 * How one run of the note came to be there, beside the run.
 *
 * The marks say who; this says the rest, and only when it is asked for — a
 * click on a marked run. What is in it is what the record has: the author and
 * the time, what stood there before, and for pi the model it was on and the
 * message the turn began with. A run of pi's is the only one with a
 * conversation behind it, so it is the only one that offers to open it.
 *
 * A popover rather than a panel: it belongs to the words it is about and goes
 * when you look away, which is how long the question lasts.
 */
export function WhyCard() {
	const why = useSyncExternalStore(whyStore.subscribe, whyStore.get);
	const at = useSyncExternalStore(askedAtStore.subscribe, askedAtStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const sessions = useSyncExternalStore(sessionsStore.subscribe, sessionsStore.get);

	// The note under it moving is the question going: a card pinned beside words
	// that have scrolled away is about nothing.
	useEffect(() => {
		if (!why) return;
		const close = () => whyStore.set(null);
		const page = document.getElementById("note");
		page?.addEventListener("scroll", close, { passive: true });
		addEventListener("resize", close);
		return () => {
			page?.removeEventListener("scroll", close);
			removeEventListener("resize", close);
		};
	}, [why]);

	if (!why || !at) return null;
	const who = why.author === "pi" ? "pi" : why.author === "outside" ? "Outside this app" : "You";
	const conversation = sessions.find((s) => s.id === why.session);

	return (
		<Popover open onOpenChange={(open) => !open && whyStore.set(null)}>
			{/* Anchored to where the run is on screen rather than to an element in the
			    page: the run is drawn by the editor, which React does not render. */}
			<PopoverAnchor asChild>
				<div className="pointer-events-none fixed" style={{ left: at.left, top: at.top, width: at.width, height: at.height }} />
			</PopoverAnchor>
			<PopoverContent align="start" side="bottom" className="flex w-80 flex-col gap-3 text-xs">
				<PopoverHeader className="flex-row items-baseline justify-between gap-2 text-xs">
					<PopoverTitle className="flex items-baseline gap-1.5">
						{who}
						{/* The model by the name it is known by; the provider is in the
						    title, where a second word would otherwise crowd the first. */}
						{why.model && (
							<span className="font-mono font-normal text-muted-foreground" title={why.model}>
								{why.model.split("/").at(-1)}
							</span>
						)}
					</PopoverTitle>
					{/* How long ago, which is what anyone reads a time for; the time
					    itself is a second away, on the hover. */}
					<span className="shrink-0 text-muted-foreground" title={new Date(why.at).toLocaleString()}>
						{ago(why.at)}
					</span>
				</PopoverHeader>

				{/* The whole of why it is there, in the words that asked for it. */}
				{why.prompt && <PopoverDescription className="line-clamp-3">“{why.prompt}”</PopoverDescription>}

				{/* Only when it stands in place of something. The words it is made of
				    are on screen behind this card — repeating them here would be
				    saying the same thing twice and calling it a diff. */}
				{why.removed && (
					<div className="flex flex-col gap-1">
						<span className="text-muted-foreground">Replaced</span>
						<Changed from={why.removed} to={why.text} />
					</div>
				)}

				{(why.entry || why.removed) && (
					<div className="flex justify-end gap-1">
						{why.removed && (
							<Button
								variant="ghost"
								size="xs"
								onClick={() => {
									putBack(why.from, why.to, why.removed!);
									whyStore.set(null);
								}}
							>
								Put it back
							</Button>
						)}
						{why.entry && (
							<Button
								variant="secondary"
								size="xs"
								onClick={() => {
									// In another conversation: go there first. The socket
									// delivers in order, so the turn is looked for in the
									// session that has it.
									if (conversation && why.session !== config?.sessionId) send({ type: "resume_session", path: conversation.path });
									send({ type: "navigate", entryId: why.entry! });
									whyStore.set(null);
								}}
							>
								Open conversation
							</Button>
						)}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

/**
 * How long ago, in the words a person uses for it.
 *
 * A note is written over hours and days, and "two hours ago" is the answer to
 * what a time is asked for here. The clock time is on the hover for when the
 * answer has to be exact. Intl does the counting and the language, so this is
 * the unit it falls into and nothing else.
 */
function ago(at: number, now = Date.now()): string {
	const seconds = Math.round((at - now) / 1000);
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		["second", 60],
		["minute", 60],
		["hour", 24],
		["day", 7],
		["week", 4.35],
		["month", 12],
		["year", Number.POSITIVE_INFINITY],
	];
	let value = seconds;
	for (const [unit, per] of units) {
		if (Math.abs(value) < per) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(value), unit);
		value /= per;
	}
	return new Date(at).toLocaleDateString();
}

/**
 * What the words were and what they are, as a diff of the two.
 *
 * Word level, as the note's own diff is: a reworded sentence shown as a whole
 * line struck through and a whole line added says less than the sentence does.
 * Drawn on the card's own surface rather than in a box — a box would make it a
 * second thing to look at, and it is a line of the card like the others.
 */
function Changed({ from, to }: { from: string; to: string }) {
	return (
		<p className="max-h-28 overflow-auto leading-relaxed whitespace-pre-wrap">
			{diffWordsWithSpace(from, to).map((part, i) => (
				<span
					key={i}
					className={
						part.added
							? "bg-[rgba(80,200,120,0.28)] rounded-[2px]"
							: part.removed
								? "bg-[color-mix(in_oklab,var(--destructive)_30%,transparent)] rounded-[2px] line-through decoration-[var(--destructive)]"
								: undefined
					}
				>
					{part.value}
				</span>
			))}
		</p>
	);
}
