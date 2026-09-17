/**
 * What pi has to say for itself, in the one line the strip keeps for it.
 *
 * One line, and not a row of them. Four things that are each true a tenth of
 * the time, each given a place of its own, is a row of empty boxes most of the
 * day; one slot with an order to fill it by is a line that always holds the
 * most important thing that is true. Every status bar that has lasted works
 * this way, and the order below is the whole of this module.
 *
 * The order is what you would do about it, not what happened last:
 *
 * 1. The socket is down. Nothing typed is going anywhere yet, and that outranks
 *    whatever pi was doing when it went.
 * 2. pi is waiting on an answer. The run has not stopped, but it is not moving
 *    either, and the only thing that will move it is you.
 * 3. pi is working: the step it is on, and how much is queued behind it.
 * 4. None of those: what the last run came to.
 *
 * The fourth is why there is anything here at rest. A slot that empties the
 * moment a run ends is empty nearly always — pi answers for a minute and sits
 * for an hour — and a strip that is mostly a gap teaches the eye to stop
 * looking at it. What the run came to is also the thing you would have gone to
 * the conversation to see, and the conversation scrolls away.
 *
 * What it came to is said in notes rather than in figures. The ring beside this
 * already carries what a session costs, and a note-taker's question about a run
 * that has finished is which of their notes it touched. The figures are not
 * lost: the line under the run itself still has the duration, the clock, the
 * tokens and the cost, and the ring's card has the session's.
 */
import { titleOf } from "../../naming.ts";
import type { Connection } from "./store.ts";
import { toolDetail } from "./toolSummary.ts";
import { formatClock, stopNote } from "./turn.ts";
import type { Item } from "./types";

export type Line =
	/** Something is in the way, and it is drawn in the colour that says so. */
	| { kind: "trouble"; why: "offline" | "waiting"; text: string }
	/** A run in flight: the step, and what is waiting behind it. */
	| { kind: "step"; what: string; detail: string | null; queued: number }
	/** At rest: what the last run came to. */
	| { kind: "last"; text: string };

/** The tools a note may be written by, and the only ones — see noteEdit.ts. */
const WRITERS = new Set(["note_edit", "note_write", "note_properties"]);

/** A tool's `path` argument, whatever else it was given. */
function pathOf(args: unknown): string | null {
	const path = (args as { path?: unknown } | null)?.path;
	return typeof path === "string" && path.trim() ? path.trim() : null;
}

/**
 * The step pi is on.
 *
 * The same words the row in the column uses: a tool is its own name and what it
 * touched (toolSummary.ts), a thought is "Thinking", and the answer being
 * written is a word rather than the answer, which is already on screen.
 *
 * The last step rather than the running one. Between a tool coming back and the
 * next thing starting there is a second with nothing in it, and a line that
 * emptied for it would blink once per tool call. What pi did last stands until
 * the next thing does.
 *
 * Nothing before the run's own first step: the search stops at the message that
 * began the run, so a run only just asked for says it is working rather than
 * repeating what the one before it ended on.
 */
export function currentStep(items: Item[]): { what: string; detail: string | null } {
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i]!;
		if (item.kind === "tool") return { what: item.name ?? "tool", detail: toolDetail(item.name, item.args) };
		if (item.kind === "thinking") return { what: "Thinking", detail: null };
		if (item.kind === "assistant") return { what: "Answering", detail: null };
		break;
	}
	return { what: "Working", detail: null };
}

/** "Stopped 10:38 PM" — a word for how it ended, and when, where there is a when. */
const at = (word: string, clock: string | null): string => {
	const said = word[0]!.toUpperCase() + word.slice(1);
	return clock ? `${said} ${clock}` : said;
};

/**
 * What the last run came to, or nothing at all when there has not been one.
 *
 * How it ended comes first where there is anything to say about it: a run that
 * was stopped or ran out of room is the one fact about it that changes what you
 * do next, and it outranks what it managed to write on the way.
 *
 * Then the notes. Names rather than paths, as everywhere else a note is named
 * in this window, and a count once there are too many names to read at a
 * glance. A tool that came back an error wrote nothing and is not counted.
 */
export function lastRun(items: Item[]): string | null {
	let end = -1;
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i]!.kind === "done") {
			end = i;
			break;
		}
	}
	if (end === -1) return null;
	const done = items[end]!;
	const clock = typeof done.endedAt === "number" ? formatClock(done.endedAt) : null;
	const ending = stopNote(done.stopReason);
	if (ending) return at(ending, clock);

	const wrote = new Set<string>();
	for (let i = end - 1; i >= 0; i--) {
		const item = items[i]!;
		if (item.kind === "done" || item.kind === "user") break;
		if (item.kind !== "tool" || item.isError || !item.name || !WRITERS.has(item.name)) continue;
		const path = pathOf(item.args);
		if (path) wrote.add(path);
	}
	if (wrote.size === 1) return `Wrote ${titleOf([...wrote][0]!)}`;
	if (wrote.size > 1) return `Wrote ${wrote.size} notes`;
	return at("answered", clock);
}

export function agentLine(state: {
	connection: Connection;
	/** Questions of pi's waiting on an answer. */
	asking: number;
	streaming: boolean;
	/** Messages written while the run goes, waiting their turn. */
	queued: number;
	items: Item[];
}): Line | null {
	if (state.connection !== "open") {
		return { kind: "trouble", why: "offline", text: state.connection === "connecting" ? "Connecting…" : "Offline — reconnecting" };
	}
	if (state.asking > 0) return { kind: "trouble", why: "waiting", text: "Waiting for your answer" };
	if (state.streaming) return { kind: "step", ...currentStep(state.items), queued: state.queued };
	const last = lastRun(state.items);
	return last ? { kind: "last", text: last } : null;
}

/**
 * The same line, as one mark: what the ring says when the agent's column is
 * folded away and there is room for nothing else.
 *
 * Several signals in one glyph, the way a phone's status bar folds signal,
 * network and battery into a single shape: the order is the line's own, so
 * the mark and the words it opens into can never disagree about what matters
 * most. One thing is added below the line's order — a run that ended while
 * nobody could see it — because the words at rest already say what the run
 * came to, and a ring that simply stops turning says nothing to someone who
 * was not looking at the moment it stopped.
 */
export type Glyph = "offline" | "waiting" | "working" | "unseen" | "idle";

export function glyphOf(line: Line | null, unseen: boolean): Glyph {
	if (line?.kind === "trouble") return line.why;
	if (line?.kind === "step") return "working";
	return unseen ? "unseen" : "idle";
}

/**
 * Whether a finished run is still waiting to be seen, after something happened.
 *
 * The way an unread mark works everywhere: set by the thing arriving where you
 * could not see it, cleared by looking. A run that ends with the column open
 * was seen ending. Looking is opening the column, where the run itself is —
 * not pointing at the mark, which a pointer does on its way past.
 */
export type SeenEvent = { type: "ended"; folded: boolean } | { type: "looked" };

export function nextUnseen(unseen: boolean, event: SeenEvent): boolean {
	if (event.type === "looked") return false;
	return event.type === "ended" ? event.folded : unseen;
}
