/**
 * The server's own state, as it arrives.
 *
 * Held outside React because the socket opens before anything mounts: the
 * opening config/usage/snapshot/sessions would otherwise land with nobody
 * listening and the settings bar would stay empty until something changed.
 */
import type { ConfigMsg, ContextSourcesMsg, PromptRequest, ServerMsg, SessionInfo, UsageMsg } from "./types";

export interface Store<T> {
	get: () => T;
	set: (next: T) => void;
	subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set: (next) => {
			value = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export const configStore = createStore<ConfigMsg | null>(null);
export const usageStore = createStore<UsageMsg | null>(null);
export const sessionsStore = createStore<SessionInfo[]>([]);
export const contextSourcesStore = createStore<ContextSourcesMsg | null>(null);

/**
 * Questions waiting on an answer. An array rather than a Map so the snapshot
 * useSyncExternalStore reads is a stable value; replaced by id so the replay a
 * reconnecting tab receives cannot double a card up.
 */
export const promptsStore = createStore<PromptRequest[]>([]);

export function addPrompt(prompt: PromptRequest): void {
	promptsStore.set([...promptsStore.get().filter((p) => p.id !== prompt.id), prompt]);
}

export function removePrompt(id: string): void {
	promptsStore.set(promptsStore.get().filter((p) => p.id !== id));
}

/** How many raw events the debug view keeps. Older ones are dropped, not the server's copy. */
const RAW_LIMIT = 300;
export const rawStore = createStore<string[]>([]);

export function pushRaw(event: ServerMsg): void {
	const next = rawStore.get().concat(JSON.stringify(event, null, 2));
	rawStore.set(next.length > RAW_LIMIT ? next.slice(next.length - RAW_LIMIT) : next);
}
