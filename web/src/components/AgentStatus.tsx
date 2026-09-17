/**
 * The half of the strip that is about pi, laid under the column it is about.
 *
 * A status bar with two things in it is two halves whether or not it says so:
 * the note's word count and pi's tool mode are not the same subject, and a
 * single row of items leaves the reader to find the seam. Here the seam is the
 * one already on screen — the divider between the note and pi — so the strip is
 * read the way the window above it is, and moving the divider moves the seam
 * with it. Xcode's bar is divided by its editor's own split for the same reason.
 *
 * What is in it is what a run is: how pi is doing, what it is allowed to do,
 * and how much of the window it has left. How it is doing is one line on the
 * left, where a line that grows reads from — see working.ts for what it says
 * and in what order. The two that are glanced at rather than read are held to
 * the right edge, where they stay put as the line beside them changes.
 *
 * None of the three was down here before. The mode and the ring sat in the
 * composer's own footer, inside the column, where they were a second row of
 * controls under the box you write in and were the first things a narrow
 * column gave up; the line was two amber sentences in that same footer, which
 * said pi was waiting for you in the one place you could not see once pi was
 * folded away.
 */
import { useSyncExternalStore } from "react";

import { configStore, promptsStore } from "../serverState";
import { getConnection, getItems, subscribe } from "../store";
import { agentLine } from "../working";
import { send } from "../ws";
import { ContextCard } from "./ContextCard";
import { ToolModes } from "./ToolModes";
import { Spinner } from "./ui/spinner";

/**
 * The one line pi has down here: what is in the way, what it is doing, or what
 * the last run came to. Which of those, and in which order, is working.ts.
 *
 * Its own subscriber, because it is the one thing in the strip that changes
 * while a run goes: the items are rebuilt on every delta, so a component that
 * reads them renders on every frame of an answer. This one is a spinner and a
 * few words, and the rest of the strip is left alone.
 *
 * The step is keyed by what it says, so a step that replaces another plays the
 * rise (styles.css) while one that is merely growing longer does not.
 */
function Line() {
	const connection = useSyncExternalStore(subscribe, getConnection);
	const items = useSyncExternalStore(subscribe, getItems);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const prompts = useSyncExternalStore(promptsStore.subscribe, promptsStore.get);
	const line = agentLine({
		connection,
		asking: prompts.length,
		streaming: config?.isStreaming ?? false,
		queued: (config?.queued.steering.length ?? 0) + (config?.queued.followUp.length ?? 0),
		items,
	});
	if (!line) return null;

	// The colour the composer used for the same two things, which is the one
	// this window keeps for "you will want to know about this" — not the one it
	// keeps for something having gone wrong, because neither of these has.
	if (line.kind === "trouble") {
		return (
			<span id="agentLine" className="min-w-0 truncate px-1.5 text-amber-600 dark:text-amber-500">
				{line.text}
			</span>
		);
	}
	if (line.kind === "last") {
		return (
			<span id="agentLine" className="min-w-0 truncate px-1.5">
				{line.text}
			</span>
		);
	}
	return (
		<span id="agentLine" className="flex min-w-0 items-center gap-1.5 px-1.5">
			<Spinner className="size-3 shrink-0" />
			<span key={`${line.what} ${line.detail}`} className="step-in flex min-w-0 items-center gap-1.5">
				<span className="shrink-0 text-foreground/80">{line.what}</span>
				{line.detail && <span className="min-w-0 truncate">{line.detail}</span>}
			</span>
			{/* Behind the step rather than beside the box they were typed in: what
			    is queued is a fact about the run, and it is the run that will take
			    them. The messages themselves are still listed above the box. */}
			{line.queued > 0 && <span className="shrink-0">· {line.queued} queued</span>}
		</span>
	);
}

export function AgentStatus({ width, folded }: { width: number | null; folded: boolean }) {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	// A width the column has not reported yet is not the same as no column, and
	// for the one frame between them this waits rather than laying itself out
	// twice.
	if (!folded && width === null) return null;
	return (
		// As wide as pi's column and one pixel more: the columns are laid inside
		// the card's rim and the strip is not, so pi's own left edge is a rim
		// further in than the strip's right edge less pi's width. The one number
		// this is told is the column's width, and the rest follows from it.
		//
		// Folded, there is no column to be as wide as, and this is why it does
		// not go with it: the strip is part of the window rather than part of
		// pi, so what pi is doing is exactly what you cannot see any other way
		// once the column is away. It takes what it needs and stays against the
		// window's edge, where it already was.
		//
		// A container of its own, so what is in it gives up its words to the
		// width it actually has — which is pi's, not the window's. The composer
		// measured the same way for the same reason, and the controls that moved
		// here brought the habit with them.
		<div
			id="agent"
			className={`@container/agent flex min-w-0 items-center gap-0.5 overflow-hidden ${folded ? "" : "shrink-0"}`}
			style={folded ? undefined : { width: width! + 1 }}
		>
			<Line />
			<div className="flex-1" />
			{config && (
				<ToolModes
					tools={config.tools}
					active={config.activeTools}
					disabled={!online}
					onSetTools={(names) => send({ type: "set_tools", names })}
				/>
			)}
			<ContextCard />
		</div>
	);
}
