/**
 * The updater, as the shell tells it — see electron/preload.cjs `update`.
 *
 * The shell keeps the one state; this is the page's copy of it and the two
 * things the page decides on its own: when a restart the person asked for
 * while the agent was working should happen, and which offers they have
 * already waved away. In a browser tab there is no shell, `window.pi` is not
 * there, and the store stays null — nothing about updates is drawn.
 */
import type { ConfigMsg } from "./types";
import { configStore, createStore } from "./serverState.ts";

export type UpdatePhase = "idle" | "checking" | "downloading" | "ready";

export interface UpdateState {
	/** The version this is. */
	current: string;
	phase: UpdatePhase;
	version: string | null;
	progress: number | null;
	error: string | null;
	justUpdated: { from: string; to: string } | null;
	/** The first run's page has been seen through. Absent in a browser, where there is no first run. */
	welcomed?: boolean;
}

export interface UpdateBridge {
	state: () => Promise<UpdateState>;
	onState: (listen: (state: UpdateState) => void) => () => void;
	check: () => Promise<void>;
	restart: () => Promise<void>;
	seen: () => Promise<void>;
	welcomed?: () => Promise<void>;
}

type Shell = {
	update?: UpdateBridge;
	choose?: () => Promise<void>;
	onOpenSettings?: (listen: (section: string) => void) => () => void;
	onOpenPage?: (listen: (page: string) => void) => () => void;
};
export const bridge = (): UpdateBridge | null => (window as unknown as { pi?: Shell }).pi?.update ?? null;
export const shell = (): Shell | null => (window as unknown as { pi?: Shell }).pi ?? null;

export const updateStore = createStore<UpdateState | null>(null);

/** A page the shell asked for — Help › What's New — until the app has opened it. */
export const pageAskedStore = createStore<string | null>(null);

/** Once, as the page starts: the state now, and every change after; and the shell's asks to open Settings or a page. */
export function wireUpdates(onOpenSettings: (section: string) => void): void {
	const pi = bridge();
	if (!pi) return;
	void pi.state().then(updateStore.set);
	pi.onState(updateStore.set);
	shell()?.onOpenSettings?.(onOpenSettings);
	shell()?.onOpenPage?.(pageAskedStore.set);
}

/** The agent has nothing in hand and nothing waiting: the moment a restart costs nobody an answer. */
export const agentIdle = (config: ConfigMsg | null): boolean =>
	!!config && !config.isStreaming && config.queued.steering.length + config.queued.followUp.length === 0;

/**
 * What the offer says, from what is known: the shell's state and the agent's.
 * A restart while the agent is mid-answer cuts that answer off, so while it
 * is working the button is for when it is done; a person who pressed that is
 * shown they are waiting, and can stop waiting.
 */
export function offer(update: UpdateState | null, config: ConfigMsg | null, waiting: boolean): { title: string; description?: string; action: "restart" | "wait" | "cancel" } | null {
	if (update?.phase !== "ready" || !update.version) return null;
	const title = `Octave ${update.version} is ready`;
	if (waiting) return { title, description: "Restarting when the agent is done.", action: "cancel" };
	if (!agentIdle(config)) return { title, description: "The agent is working; it will finish first.", action: "wait" };
	return { title, action: "restart" };
}

/**
 * Restart once the agent is idle — now, if it already is. Returns the way to
 * change one's mind. Watches the config the server sends, which is how the
 * page knows about the agent in the first place.
 */
export function restartWhenIdle(pi: UpdateBridge = bridge()!): () => void {
	let done = false;
	const go = () => {
		if (done || !agentIdle(configStore.get())) return;
		done = true;
		stop();
		void pi.restart();
	};
	const stop = configStore.subscribe(go);
	go();
	return () => {
		done = true;
		stop();
	};
}

/** Offers waved away, by version, for this window's life: a newer version is a new offer. */
const DISMISSED = "update-dismissed";
export const dismissed = (version: string): boolean => {
	try {
		return sessionStorage.getItem(DISMISSED) === version;
	} catch {
		return false;
	}
};
export const dismiss = (version: string): void => {
	try {
		sessionStorage.setItem(DISMISSED, version);
	} catch {
		// Storage that cannot be written costs a dismissal its memory, nothing more.
	}
};
