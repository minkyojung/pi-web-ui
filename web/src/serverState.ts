/**
 * The server's own state, as it arrives.
 *
 * Held outside React because the socket opens before anything mounts: the
 * opening config/usage/snapshot/sessions would otherwise land with nobody
 * listening and the settings bar would stay empty until something changed.
 */
import type { Suggestions } from "../../properties.ts";
import type { Registry } from "../../propertyTypes.ts";
import type {
	GitStanding,
	AuthorsMsg,
	Backlink,
	BranchPoint,
	CodeGoneMsg,
	CodeMsg,
	CommitGoneMsg,
	CommitMsg,
	TaskGoneMsg,
	TaskMsg,
	ConfigMsg,
	CommandInfo,
	ContextSourcesMsg,
	LoginDoneMsg,
	LoginEvent,
	LoginEventMsg,
	LoginPrompt,
	LoginPromptDismissMsg,
	LoginPromptMsg,
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
	ProviderInfo,
	RunUndoneMsg,
	SearchResultsMsg,
	ServerMsg,
	SessionInfo,
	SettingsMsg,
	SpecInfo,
	SpecMsg,
	Tagged,
	UsageMsg,
	WhyMsg,
} from "./types";

export interface Store<T> {
	get: () => T;
	set: (next: T) => void;
	subscribe: (listener: () => void) => () => void;
}

/**
 * A store made here is the folder's unless it says it is the window's: the
 * folder's are cleared to how they began when the window moves to another
 * workspace (resetAll, switch.ts), since everything the server said was
 * said of the folder that was; the window's — the theme, a dialog open —
 * stay. Cleared with the value they were made with, so what they hold must
 * be replaced rather than changed in place, which is how React reads them.
 */
const folders: (() => void)[] = [];

export function createStore<T>(initial: T, { window = false }: { window?: boolean } = {}): Store<T> {
	let value = initial;
	const listeners = new Set<() => void>();
	if (!window) folders.push(() => set(initial));
	function set(next: T): void {
		value = next;
		for (const listener of listeners) listener();
	}
	return {
		get: () => value,
		set,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export const configStore = createStore<ConfigMsg | null>(null);
/** The providers and who is signed in, as the server last said. See ProvidersMsg. */
export const providersStore = createStore<ProviderInfo[] | null>(null);
/** Octave's own settings, as the server last said. See SettingsMsg. */
export const settingsStore = createStore<SettingsMsg | null>(null);

/**
 * Settings from the server, by the socket or as the answer to a change, unless
 * what is held is a later write of the same run — which is how an answer that
 * arrives after the news of a newer change does not put the old value back.
 */
export function applySettings(msg: SettingsMsg): void {
	const held = settingsStore.get()?.revision;
	if (held && held.boot === msg.revision.boot && held.n > msg.revision.n) return;
	settingsStore.set(msg);
}

/**
 * The sign-in under way, as the server tells it: which provider, the question
 * waiting if one is, what pi has said so far, and how it ended. Null when none
 * is. See login.ts.
 */
export interface LoginState {
	provider: string;
	prompt: LoginPrompt | null;
	events: LoginEvent[];
	done: { ok: boolean; error?: string } | null;
}
export const loginStore = createStore<LoginState | null>(null);

/** Fold one of the server's login messages into loginStore. */
export function applyLogin(msg: LoginPromptMsg | LoginPromptDismissMsg | LoginEventMsg | LoginDoneMsg): void {
	const was = loginStore.get();
	switch (msg.type) {
		case "login_prompt": {
			const provider = msg.prompt.provider;
			const same = was && was.provider === provider && !was.done ? was : { provider, prompt: null, events: [], done: null };
			loginStore.set({ ...same, prompt: msg.prompt });
			return;
		}
		case "login_prompt_dismiss":
			if (was?.prompt?.id === msg.id) loginStore.set({ ...was, prompt: null });
			return;
		case "login_event": {
			const same = was && was.provider === msg.provider && !was.done ? was : { provider: msg.provider, prompt: null, events: [], done: null };
			loginStore.set({ ...same, events: [...same.events, msg.event] });
			return;
		}
		case "login_done":
			loginStore.set({ provider: msg.provider, prompt: null, events: was?.provider === msg.provider ? was.events : [], done: { ok: msg.ok, error: msg.error } });
			return;
	}
}
export const usageStore = createStore<UsageMsg | null>(null);
export const sessionsStore = createStore<SessionInfo[]>([]);
export const contextSourcesStore = createStore<ContextSourcesMsg | null>(null);
/** What "/" can name in the composer. See CommandsMsg. */
export const commandsStore = createStore<CommandInfo[]>([]);

/**
 * The fork points on the conversation being shown, from the server's reading of
 * the session tree. Empty until a question has been asked more than one way.
 */
export const branchesStore = createStore<BranchPoint[]>([]);

/** The notes in the working folder, as the server last listed them. */
export const filesStore = createStore<NoteFile[]>([]);

/** The documents beside the notes — a PDF the agent can read — by path, as the server last listed them. */
export const documentsStore = createStore<string[]>([]);

/**
 * Every file of the repository the folder is, as git last listed them
 * (RepoMsg). Empty for a folder that is in none, which is also what it says
 * before the server has answered — the palette then offers what it always did.
 */
export const repoStore = createStore<string[]>([]);

/**
 * The repository held more files than the list would take, so `repoStore` is
 * not all of them — a thing to say where the palette says what it has, rather
 * than to let a file be missing from it with nothing to explain why.
 */
export const repoTruncatedStore = createStore<boolean>(false);

/**
 * The file a code tab is reading, as the server last read it off the disk, or
 * why there is nothing to read (CodeMsg). One store for the one tab in front:
 * the middle column draws only what is in front, so a second would never be
 * looked at. Null before anything has been asked for.
 */
export const codeStore = createStore<CodeMsg | CodeGoneMsg | null>(null);

/** The commit a tab asked to read, or that there is none — the last answer, whoever asked (Commit.tsx tells its own by `asked`). */
export const commitStore = createStore<CommitMsg | CommitGoneMsg | null>(null);

/** The task a tab asked to look at, or that it was never run — the last answer, whoever asked (Task.tsx tells its own by spec and number). */
export const taskStore = createStore<TaskMsg | TaskGoneMsg | null>(null);

/**
 * How many notices and errors the server has said. A command sent for the
 * person has no answer of its own, but every way one of spec.ts's ends says
 * something — done, or why not — so a control waiting on one watches this
 * move (AcceptAction.tsx).
 */
export const noticesStore = createStore(0);

/**
 * Where each spec stands — what is approved, what is waiting for the person —
 * as the server last read it off the folder. Null until it has said, which is
 * not the same as a folder with no specs in it (SpecsMsg).
 */
export const specsStore = createStore<SpecInfo[] | null>(null);

/** Where the folder's branch stands, as git last said; null before the server has said, or where there is no branch. */
export const standingStore = createStore<GitStanding | null>(null);

/**
 * The folder held more notes than the walk would take, so this list is not all
 * of them. Worth a line on screen: a note that is in the folder and in no list
 * is missing from the tree and from a search of every note, with nothing to
 * say why.
 */
export const filesTruncatedStore = createStore<boolean>(false);

/** The notes that link to each note, as last told, by path. */
export const backlinksStore = createStore<Record<string, Backlink[]>>({});

export function setBacklinks(path: string, notes: Backlink[]): void {
	backlinksStore.set({ ...backlinksStore.get(), [path]: notes });
}

/** The notes that share a tag with each note, as last told, by path. */
export const taggedStore = createStore<Record<string, Tagged[]>>({});

/** The property types chosen for the vault, by name; a name not here is guessed from its value. */
export const propertyTypesStore = createStore<Registry>({});

/** What the vault's notes call their properties and what they put in them, for the boxes that offer them. */
export const propertyNamesStore = createStore<Suggestions>({ names: [], values: {} });

export function setTagged(path: string, notes: Tagged[]): void {
	taggedStore.set({ ...taggedStore.get(), [path]: notes });
}

/**
 * The last note the server sent, whichever tab or writer caused it — or spec,
 * which the same editor shows. The editor reads it and decides what to do:
 * its own, or one it is not showing.
 */
export const noteStore = createStore<NoteMsg | SpecMsg | null>(null);

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

/**
 * Who wrote which words of a note, as last asked for. One answer at a time:
 * it is asked about the note in front, and the next question replaces it.
 */
export const authorsStore = createStore<AuthorsMsg | null>(null);

/**
 * How one run of the note came to be there, as last asked for. One at a time:
 * it is asked by clicking a run, and clicking another replaces it.
 */
export const whyStore = createStore<WhyMsg | null>(null);

/** A note that is not on disk any more. A tab with it open puts it to the person. */
export const noteGoneStore = createStore<NoteGoneMsg | null>(null);

/** A save this tab made that was refused. Cleared by whoever deals with it. */
export const noteConflictStore = createStore<NoteConflictMsg | null>(null);

/** The last search answer this tab got. The palette shows it only if it answers the latest ask. */
export const searchResultsStore = createStore<SearchResultsMsg | null>(null);

/** What the last "put back this run" came to. One at a time: the footer that asked reads it. */
export const runUndoneStore = createStore<RunUndoneMsg | null>(null);

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

/** Every store of the folder's cleared to how it began — the window is moving to another workspace. */
export function resetAll(): void {
	for (const reset of folders) reset();
}
