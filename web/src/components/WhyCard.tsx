import { useEffect, useSyncExternalStore } from "react";
import { diffWordsWithSpace } from "diff";

import { askedAtStore, putBack } from "../features/authors";
import { configStore, sessionsStore, whyStore } from "../serverState";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";

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
			<PopoverContent align="start" side="bottom" className="w-96 p-0 text-xs">
				<div className="flex flex-col gap-2 p-3">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span className="font-medium text-foreground">{who}</span>
						{why.model && <span className="font-mono text-muted-foreground">{why.model}</span>}
						<span className="text-muted-foreground">{new Date(why.at).toLocaleString()}</span>
					</div>
					{why.prompt && (
						<p className="line-clamp-3 border-l-2 border-border pl-2 text-muted-foreground italic">{why.prompt}</p>
					)}
					<Changed from={why.removed} to={why.text} />
				</div>
				{(why.entry || why.removed) && (
					<div className="flex justify-end gap-1 border-t p-2">
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
 * What the words were and what they are, as a diff of the two.
 *
 * Word level, as the note's own diff is: a reworded sentence shown as a whole
 * line struck through and a whole line added says less than the sentence does.
 * With nothing to compare against — the run is no longer the whole of what its
 * change wrote — there is only what is there now, and saying that plainly is
 * better than implying it replaced nothing.
 */
function Changed({ from, to }: { from?: string; to: string }) {
	if (!from) return <p className="max-h-32 overflow-auto rounded border bg-muted/40 p-2 whitespace-pre-wrap">{to}</p>;
	return (
		<p className="max-h-32 overflow-auto rounded border bg-muted/40 p-2 whitespace-pre-wrap">
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
