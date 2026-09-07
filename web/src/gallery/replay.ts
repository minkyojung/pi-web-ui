import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { branchesStore } from "../serverState";
import { createConversationStore } from "../store";
import type { BranchPoint, Item, ServerMsg } from "../types";
import type { Scenario } from "./scenarios";

/**
 * How long to hold an event before the next one.
 *
 * Guessed, not recorded: `scripts/record.mjs` stores the events and not their
 * arrival times, so a recording has no rhythm of its own to replay. Close
 * enough to tune the shape of a run; not close enough to tune a spinner's
 * threshold against a real provider.
 */
function delayFor(event: ServerMsg): number {
	const sub = (event as { assistantMessageEvent?: { type?: string } }).assistantMessageEvent?.type;
	if (sub === "text_delta" || sub === "thinking_delta") return 10;
	if (event.type === "tool_execution_update") return 60;
	return 140;
}

/**
 * One message, the way the socket would hand it over.
 *
 * Most of what arrives is a conversation event and goes to the reducer, but not
 * all of it: a resumed session arrives whole as a snapshot, and where it has
 * branches arrives beside it. The bench takes both, or half of what the app
 * does could not be looked at here.
 */
function feed(store: ReturnType<typeof createConversationStore>, event: ServerMsg): void {
	if (event.type === "snapshot") store.replaceConversation((event as { items: Item[] }).items);
	else if (event.type === "branches") branchesStore.set((event as { nodes: BranchPoint[] }).nodes);
	else store.applyServerEvent(event);
}

export interface Replay {
	items: Item[];
	cursor: number;
	total: number;
	/** The event that produced what is currently on screen, if any. */
	last: ServerMsg | null;
	playing: boolean;
	setPlaying: (on: boolean) => void;
	speed: number;
	setSpeed: (to: number) => void;
	done: boolean;
	seek: (to: number) => void;
	step: () => void;
}

/**
 * One scenario, folded through the reducer at a controllable rate.
 *
 * The store is this hook's own, not the live one: a scenario reset would
 * otherwise wipe the running session's conversation, and a snapshot arriving
 * mid-replay would wipe the scenario.
 */
export function useReplay(scenario: Scenario): Replay {
	const [events, setEvents] = useState<ServerMsg[]>([]);
	const [store, setStore] = useState(createConversationStore);
	const [cursor, setCursor] = useState(0);
	const [playing, setPlaying] = useState(true);
	const [speed, setSpeed] = useState(1);

	const items = useSyncExternalStore(store.subscribe, store.getItems);

	// A scenario's events are fetched — recordings are their own chunk — so the
	// bench empties first and fills when they land, rather than showing the
	// previous scenario's tail under the new scenario's name.
	useEffect(() => {
		let current = true;
		setEvents([]);
		setStore(createConversationStore());
		branchesStore.set([]);
		setCursor(0);
		scenario.load().then((loaded) => {
			if (!current) return;
			setEvents(loaded);
			setPlaying(true);
		});
		return () => {
			current = false;
		};
	}, [scenario]);

	/**
	 * The reducer folds forward only — there is no way to take an event back —
	 * so going anywhere but forward means starting over and replaying up to
	 * there. Instant, since nothing waits between events.
	 */
	const seek = useCallback(
		(to: number) => {
			const next = createConversationStore();
			branchesStore.set([]);
			for (let i = 0; i < to; i++) feed(next, events[i]);
			setStore(next);
			setCursor(to);
		},
		[events],
	);

	const step = useCallback(() => {
		if (cursor >= events.length) return;
		feed(store, events[cursor]);
		setCursor(cursor + 1);
	}, [cursor, events, store]);

	useEffect(() => {
		if (!playing || cursor >= events.length) return;
		const timer = setTimeout(step, delayFor(events[cursor]) / speed);
		return () => clearTimeout(timer);
	}, [playing, cursor, events, speed, step]);

	return {
		items,
		cursor,
		total: events.length,
		last: cursor > 0 ? events[cursor - 1] : null,
		playing,
		setPlaying,
		speed,
		setSpeed,
		done: events.length > 0 && cursor >= events.length,
		seek,
		step,
	};
}
