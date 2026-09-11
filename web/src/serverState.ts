/**
 * The server's own state, as it arrives.
 *
 * Held outside React because the socket opens before anything mounts: the
 * opening config/usage/snapshot/sessions would otherwise land with nobody
 * listening and the settings bar would stay empty until something changed.
 */
import type {
	BranchPoint,
	ConfigMsg,
	ContextSourcesMsg,
	NoteChangedMsg,
	NoteConflictMsg,
	NoteCreatedMsg,
	NoteDeletedMsg,
	NoteFile,
	NoteGoneMsg,
	NoteRenamedMsg,
	NoteRenameFailedMsg,
	NoteMsg,
	PromptRequest,
	ServerMsg,
	SessionInfo,
	UsageMsg,
} from "./types";

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
 * The fork points on the conversation being shown, from the server's reading of
 * the session tree. Empty until a question has been asked more than one way.
 */
export const branchesStore = createStore<BranchPoint[]>([]);

/** The notes in the working folder, as the server last listed them. */
export const filesStore = createStore<NoteFile[]>([]);

/**
 * The last note the server sent, whichever tab or writer caused it. The editor
 * reads it and decides what to do: its own, or one it is not showing.
 */
export const noteStore = createStore<NoteMsg | null>(null);

/** The last change to a note the server sent, from whichever writer. */
export const noteChangedStore = createStore<NoteChangedMsg | null>(null);

/** A note this tab asked for and now exists, waiting to be opened. Cleared by whoever opens it. */
export const noteCreatedStore = createStore<NoteCreatedMsg | null>(null);

/** A note that moved. A tab with the old path open follows it. */
export const noteRenamedStore = createStore<NoteRenamedMsg | null>(null);

/** A rename this tab asked for that was refused. Cleared by the title field. */
export const noteRenameFailedStore = createStore<NoteRenameFailedMsg | null>(null);

/**
 * The last note put in the trash from anywhere, kept so it can be brought
 * back with one press. Replaced by the next; forgotten when restored.
 */
export const noteDeletedStore = createStore<NoteDeletedMsg | null>(null);

/** A note that is not on disk any more. A tab with it open puts it to the person. */
export const noteGoneStore = createStore<NoteGoneMsg | null>(null);

/** A save this tab made that was refused. Cleared by whoever deals with it. */
export const noteConflictStore = createStore<NoteConflictMsg | null>(null);

/**
 * Text a cleared queue handed back, waiting to be put in the composer. Emptied
 * by whoever takes it, so a second clear is not confused for the first.
 */
export const restoredStore = createStore<string | null>(null);

/**
 * The question being asked again, if there is one.
 *
 * Held here and not sent anywhere until the new question is: pressing the
 * pencil only copies text into the box, so changing your mind costs nothing.
 * The session's leaf moves when something is actually sent, which is the point
 * after which there is nothing to undo.
 */
export const askingAgainStore = createStore<{ entryId: string; text: string } | null>(null);

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
export const rawStore = createStore<ServerMsg[]>([]);

/**
 * The message itself, not its JSON. Serialising here would run on every text
 * delta of every run to feed a view that is almost always closed; RawView does
 * it instead, when someone is looking.
 */
export function pushRaw(event: ServerMsg): void {
	const next = rawStore.get().concat(event);
	rawStore.set(next.length > RAW_LIMIT ? next.slice(next.length - RAW_LIMIT) : next);
}
