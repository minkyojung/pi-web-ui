import { useEffect, useSyncExternalStore } from "react";
import { diffWordsWithSpace } from "diff";

import * as colour from "../changed";
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

				{/* The change itself, in the shape a diff is read in: what the run
				    replaced above what it says now, and only the second row when it
				    replaced nothing, which is what an addition is in any diff. Not a
				    repetition of the note behind the card — the underline says where
				    pi wrote, and these say exactly what. Absent rather than empty
				    means the run has been cut since and what it stood in place of is
				    not known, so nothing is claimed about it. */}
				{why.removed !== undefined && <Changed from={why.removed} to={why.text} />}

				{(why.entry || why.removed !== undefined) && (
					<div className="flex justify-end gap-1">
						{/* The same word the diff in the note uses for the same thing:
						    the note back as it was here, which for an addition is the
						    words gone and for a replacement is the old ones returned.
						    Offered only where what to go back to is known. */}
						{why.removed !== undefined && (
							<Button
								variant="ghost"
								size="xs"
								onClick={() => {
									putBack(why.from, why.to, why.removed!);
									whyStore.set(null);
								}}
							>
								Undo
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
 * What the words were and what they are: the two, one over the other.
 *
 * The shape a diff is read in everywhere — the old above the new, a − and a +
 * down the side — with the difference marked inside each row rather than by
 * the rows themselves. Line by line is how a diff of code is drawn, and this
 * is not code: a prose line is where the window happened to wrap, so a
 * sentence with one word changed would come out as a paragraph taken away and
 * a paragraph put back, which says less than the sentence does. The note's own
 * diff made the same choice for the same reason, and wears the same colours,
 * which come from one place so the two cannot drift apart (changed.ts).
 *
 * Trimmed at the ends, since what is being compared is words and a trailing
 * newline drawn as an empty row is a line about nothing.
 */
function Changed({ from, to }: { from: string; to: string }) {
	const parts = diffWordsWithSpace(from.trim(), to.trim());
	return (
		<div className="flex max-h-32 flex-col gap-0.5 overflow-auto">
			{/* Nothing replaced, nothing to draw above: an addition in a diff is the
			    one row, as it is in every diff. */}
			{from.trim() !== "" && (
				<Row sign="−" wash={colour.removedLine}>
					{parts
						.filter((part) => !part.added)
						.map((part, i) => (
							<span
								key={i}
								style={part.removed ? { background: colour.removed, textDecoration: "line-through", textDecorationColor: colour.removedRule, borderRadius: "2px" } : undefined}
							>
								{part.value}
							</span>
						))}
				</Row>
			)}
			<Row sign="+" wash={colour.addedLine}>
				{parts
					.filter((part) => !part.removed)
					.map((part, i) => (
						<span key={i} style={part.added ? { background: colour.added, borderRadius: "2px" } : undefined}>
							{part.value}
						</span>
					))}
			</Row>
		</div>
	);
}

/** One side of it: the mark down the edge, and the words. */
function Row({ sign, wash, children }: { sign: string; wash: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-1.5 rounded-sm px-1 py-0.5 leading-relaxed" style={{ backgroundColor: wash }}>
			<span className="shrink-0 select-none text-muted-foreground">{sign}</span>
			<span className="min-w-0 whitespace-pre-wrap">{children}</span>
		</div>
	);
}
