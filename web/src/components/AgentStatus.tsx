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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { atEndStore } from "../atEnd";
import { bridge as githubBridge, githubStore } from "../github";
import { configStore, promptsStore, standingStore } from "../serverState";
import { openSettings } from "../settingsOpen";
import { getConnection, getItems, subscribe } from "../store";
import { agentLine, glyphOf, moreWords, nextUnseen, resultSeen, taskLabel, taskTitle } from "../working";
import { send } from "../ws";
import { ContextCard } from "./ContextCard";
import { ToolModes } from "./ToolModes";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

/**
 * A word at the foot when the agent has nothing to push with: the workspace
 * has a remote and the shell has no GitHub sign-in to hand down. Only in the
 * app, and only then — signed in, or with no remote to reach, there is
 * nothing to say. It goes to Settings › Accounts, where the sign-in is.
 */
function NoGitHub() {
	const github = useSyncExternalStore(githubStore.subscribe, githubStore.get);
	const git = useSyncExternalStore(standingStore.subscribe, standingStore.get);
	if (!githubBridge || !github || github.state === "signed-in" || !git?.base) return null;
	return (
		<Button
			id="noGitHub"
			type="button"
			variant="ghost"
			size="sm"
			className="h-5 shrink-0 px-1.5 text-[11px] font-normal text-amber-600 dark:text-amber-500"
			title="The agent has no GitHub sign-in to push with. Sign in under Settings › Accounts."
			onClick={() => openSettings("Accounts")}
		>
			GitHub: not signed in
		</Button>
	);
}

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
 *
 * `bare` leaves the spinner out, for when the ring beside it is already
 * turning: two things going round side by side say one thing twice.
 */
function Line({ bare = false }: { bare?: boolean }) {
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
		task: config?.run ?? null,
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
			{!bare && <Spinner className="size-3 shrink-0" />}
			{/* The task before the step, when the run is one: which, then what it
			    is doing. A chip, as Read-only is over a file — the number is the
			    name of a line in the list, a value and not words to read — with
			    the objective and the queue in its title (working.ts). */}
			{line.task && (
				<Badge id="agentTask" variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px] font-normal tabular-nums" title={taskTitle(line.task)}>
					{taskLabel(line.task)}
				</Badge>
			)}
			<span key={`${line.what} ${line.detail}`} className="step-in flex min-w-0 items-center gap-1.5">
				<span className="shrink-0 text-foreground/80">{line.what}</span>
				{line.detail && <span className="min-w-0 truncate">{line.detail}</span>}
			</span>
			{/* Behind the step rather than beside the box they were typed in: what
			    is queued is a fact about the run, and it is the run that will take
			    them. The messages themselves are still listed above the box. */}
			{line.queued > 0 && <span className="shrink-0">· {line.queued} queued</span>}
			{/* And how many tasks are queued after this one, which are the run's too. */}
			{line.task && moreWords(line.task) && (
				<span id="agentMore" className="shrink-0 text-muted-foreground" title={taskTitle(line.task)}>
					· {moreWords(line.task)}
				</span>
			)}
		</span>
	);
}

/** Whether this window is in front of somebody: shown, and the one with the focus. */
const windowShown = () => document.visibilityState === "visible" && document.hasFocus();
function subscribeShown(changed: () => void): () => void {
	addEventListener("focus", changed);
	addEventListener("blur", changed);
	document.addEventListener("visibilitychange", changed);
	return () => {
		removeEventListener("focus", changed);
		removeEventListener("blur", changed);
		document.removeEventListener("visibilitychange", changed);
	};
}

/**
 * Folded, the half is the ring alone, and the ring says what the line would.
 *
 * A phone's status bar does this with signal, network and battery: several
 * states, one shape, the words a gesture away. Here the gesture is pointing at
 * the ring or reaching it from the keyboard, and the words open out of it
 * leftwards, the way the half grew into the strip in the first place. Pressing
 * it opens the column — the one thing anybody pointing at the agent's state
 * with the column folded is about to want.
 *
 * It stays open while it is being used, not only while it is pointed at: the
 * tool menu and the ring's card are drawn in a layer of their own, and a
 * pointer that crosses into either has left this box without leaving the
 * thing it opened. A row that folded shut under an open menu would take the
 * menu's trigger with it.
 *
 * A keyboard focus opens it; a click's focus does not. The one says "show me
 * what is here", the other only lands on the way to pressing something, and a
 * row that stayed open because it had once been clicked would be a row that
 * no longer folds.
 */
export function AgentStatus({ width, folded, onUnfold }: { width: number | null; folded: boolean; onUnfold: () => void }) {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const connection = useSyncExternalStore(subscribe, getConnection);
	const prompts = useSyncExternalStore(promptsStore.subscribe, promptsStore.get);
	const online = connection === "open";
	const streaming = config?.isStreaming ?? false;

	const [pointed, setPointed] = useState(false);
	const [reached, setReached] = useState(false);
	const [menu, setMenu] = useState(false);
	const [card, setCard] = useState(false);
	const open = folded && (pointed || reached || menu || card);

	// A run that ends out of sight is unread until its result has been on
	// screen — see resultSeen for what that takes, and why pointing at the ring
	// is not it. Only the moment a run stops counts as its ending, so what was
	// true on the last render is kept beside what is true on this one.
	const atEnd = useSyncExternalStore(atEndStore.subscribe, atEndStore.get);
	const shown = useSyncExternalStore(subscribeShown, windowShown);
	const seen = resultSeen({ folded, atEnd, shown });
	const [unseen, setUnseen] = useState(false);
	const wasStreaming = useRef(streaming);
	useEffect(() => {
		if (wasStreaming.current && !streaming) setUnseen((u) => nextUnseen(u, { type: "ended", seen }));
		wasStreaming.current = streaming;
	}, [streaming, seen]);
	useEffect(() => {
		if (seen) setUnseen((u) => nextUnseen(u, { type: "looked" }));
	}, [seen]);

	// The mark needs the line's kind and not its words, and the kind is decided
	// before the conversation is read. So it is asked without the items, and this
	// does not render again on every delta of an answer the way Line does.
	const glyph = folded
		? glyphOf(agentLine({ connection, asking: prompts.length, streaming, queued: 0, items: [] }), unseen)
		: "idle";

	// A width the column has not reported yet is not the same as no column, and
	// for the one frame between them this waits rather than laying itself out
	// twice.
	if (!folded && width === null) return null;
	return (
		// Open, as wide as pi's column and one pixel more: the columns are laid
		// inside the card's rim and the strip is not, so pi's own left edge is a
		// rim further in than the strip's right edge less pi's width. The one
		// number this is told is the column's width, and the rest follows from it.
		//
		// A container of its own while it is that wide, so what is in it gives up
		// its words to pi's width rather than the window's. Folded there is no
		// width to measure against: it is as wide as what it holds.
		//
		// Folded, the ring's own width, or everything's once it opens. The two are
		// a length and a keyword, and it is `interpolate-size` in styles.css that
		// lets the one become the other gradually — so the words are laid out in
		// full the whole time, the box is what grows, and the ring stays against
		// the window's edge because the row is packed from its end.
		<div
			id="agent"
			data-folded={folded || undefined}
			data-open={open || undefined}
			className={
				folded
					? "agent-fold flex min-w-0 items-center justify-end overflow-hidden"
					: "@container/agent flex min-w-0 shrink-0 items-center gap-0.5 overflow-hidden"
			}
			style={folded ? { width: open ? "auto" : "2rem" } : { width: width! + 1 }}
			onPointerEnter={() => setPointed(true)}
			onPointerLeave={() => setPointed(false)}
			onFocus={(e) => setReached(e.target.matches(":focus-visible"))}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setReached(false);
			}}
		>
			<div
				className={
					folded
						? `flex items-center gap-0.5 transition-opacity duration-200 ${open ? "min-w-0 opacity-100" : "shrink-0 opacity-0"}`
						: "flex min-w-0 flex-1 items-center gap-0.5"
				}
			>
				<Line bare={folded} />
				<div className="flex-1" />
				{!folded && <NoGitHub />}
				{config && (
					<ToolModes
						tools={config.tools}
						active={config.activeTools}
						disabled={!online}
						onSetTools={(names) => send({ type: "set_tools", names })}
						onOpenChange={setMenu}
					/>
				)}
			</div>
			<ContextCard status={glyph} quiet={folded && !open} onOpenChange={setCard} onClick={folded ? onUnfold : undefined} />
		</div>
	);
}
