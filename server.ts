/**
 * A web UI over one pi coding-agent session.
 *
 * Serves the built client from dist/, owns an AgentSessionRuntime, and forwards
 * every session event to connected browsers as raw JSON. The browser holds no
 * state of its own: config, usage, sessions, and snapshot messages describe the
 * server's state and are rebroadcast whenever it changes.
 */

import { existsSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type AgentSessionEvent,
	type CreateAgentSessionRuntimeFactory,
	readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { itemsFromMessages, textOf } from "./conversation.js";
import { modeToolNames } from "./toolModes.ts";
import { clampLevel, isUnknownModel, loadoutOf, lostProviders, modelsNotice as modelsNotice_, providerInfo, supportedLevels } from "./models.ts";
import { readSettings, writeSettings } from "./settings.ts";
import { askForName } from "./sessionName.ts";
import { askUser } from "./askUser.ts";
import { createPromptBridge } from "./prompts.ts";
import { branchPoints } from "./branches.ts";
import { listNotes, newNoteName, type Note, readNote, renameNote, restoreNote, withCreated, writeNote, type WriteResult } from "./vault.ts";
import { FileIndex } from "./fileIndex.ts";
import { startLogging } from "./log.ts";
import { deleteNote, shellTrash } from "./trash.ts";
import { createLoginBridge } from "./login.ts";
import { noteTools } from "./noteEdit.ts";
import { claimAppDir } from "./appDir.ts";
import { decide, type Change, historyOf, type Holed, logNames, mapThrough, moveHistory, type Origin, reconcile, record, readHistory, trashLog, undecided, wroteIn } from "./history.ts";
import { answering, asked, under, type Ask, type AskOutcome } from "./ask.ts";
import { type Claim, recorder } from "./recorder.ts";
import { watchNotes } from "./watcher.ts";
import { guard, VAULT_PROMPT } from "./guard.ts";
import { renameTarget } from "./naming.ts";
import { LinkStore, type Touched } from "./linkIndex.ts";
import { PropertyStore } from "./propertyIndex.ts";
import { PropertyRegistry } from "./propertyRegistry.ts";
import { isPropertyType } from "./propertyTypes.ts";
import { backlinksOf, retarget } from "./links.ts";
import { search } from "./search.ts";
import type {
	BranchesMsg,
	ClientMsg,
	ConfigMsg,
	ContextSourcesMsg,
	FilesMsg,
	ModelInfo,
	NoteChangedMsg,
	NoteMsg,
	PiEventMsg,
	ProvidersMsg,
	ServerMsg,
	SessionsMsg,
	SnapshotMsg,
	UsageMsg,
} from "./protocol.ts";

/**
 * What this process says, to a file as well as to the terminal — see log.ts.
 * First, so that what follows is in it. What it cannot catch is a line printed
 * while another module was being loaded, since those run before this body
 * does; in practice that is pi's own extensions announcing themselves.
 */
const logFile = startLogging();

const PORT = Number(process.env.PORT ?? 3000);
/**
 * Loopback by default. There is no authentication here and the agent runs shell
 * commands with this process's permissions, so anything that can reach the port
 * has the machine. Binding every interface — which is what listen() does when
 * you leave the host out — hands that to whoever else is on the wifi. Set
 * HOST=0.0.0.0 to expose it on purpose.
 */
const HOST = process.env.HOST ?? "127.0.0.1";
/**
 * Where the agent reads and writes. Inherited from the shell when this is run
 * from a terminal, which is what you want there; the desktop app has no useful
 * working directory of its own, so it asks and passes the answer in.
 */
const CWD = process.env.WORKDIR ?? process.cwd();
if (!existsSync(CWD)) {
	console.error(`working folder does not exist: ${CWD}`);
	process.exit(1);
}

/**
 * JSON.stringify that survives circular references and Error values.
 *
 * Only the current ancestor path counts as "seen". Tracking every visited
 * object instead would collapse an object that merely appears twice in the
 * tree, which is a shape pi actually emits.
 */
function safeStringify(value: unknown): string {
	const ancestors: unknown[] = [];
	return JSON.stringify(
		value,
		function (this: unknown, _key, val) {
			if (val instanceof Error) return { name: val.name, message: val.message };
			if (typeof val === "bigint") return val.toString();
			if (typeof val !== "object" || val === null) return val;
			// `this` is the object val was read from, so unwinding to it leaves
			// exactly the path from the root to val on the stack.
			while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
			if (ancestors.includes(val)) return "[Circular]";
			ancestors.push(val);
			return val;
		},
		2,
	);
}

const modelRuntime = await ModelRuntime.create();

const modelKey = (m: { provider: string; id: string }) => `${m.provider}/${m.id}`;

/**
 * Models with usable credentials, as of pi's last pass over them — which is
 * run again whenever it can have gone stale; see refreshModels below.
 */
const availableModels = () => modelRuntime.getAvailableSnapshot();

/**
 * The runtime, not a bare session: /new and /resume replace the AgentSession
 * object, and only the runtime can do that. Everything below reads
 * runtime.session rather than capturing it.
 */
/**
 * The note open in the editor of the tab that last sent a prompt, and the
 * words chosen in it, given to pi for the turn as lines of the system prompt
 * — see guard.ts. One value, not one per tab: pi has one conversation.
 */
let openNote: { path: string; chosen: string | null } | null = null;

/**
 * The ask waiting for an answer, if there is one: what was chosen, where the
 * note's log stood when it was asked, and how to tell the tab it is over.
 *
 * One at a time. pi has one conversation, and an answer that could belong to
 * either of two asks belongs to neither — so a second ask, or anything else
 * said to pi meanwhile, ends the one waiting rather than guessing.
 */
let asking: (Ask & { at: number; done: (outcome: AskOutcome) => void }) | null = null;

/**
 * The way to ask this session's recorder whether a write found on disk is
 * pi's — see recorder.ts. Null between sessions, so a retired recorder cannot
 * still be answering for the one that replaced it.
 */
let claimant: Claim | null = null;

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
	// Built here rather than in the list below, because what it hears about
	// pi's shell is also what the watcher asks — and the one that answers has
	// to be this session's, not the one being replaced.
	const notes = recorder(CWD, (path, base, changes) => wrote(path, base, changes));
	claimant = notes.claim;
	const services = await createAgentSessionServices({
		cwd,
		modelRuntime,
		// Inline rather than a file under .pi/extensions/: that path needs the
		// project trusted, and the desktop shell's cwd is wherever it was opened.
		resourceLoaderOptions: {
			// pi is told this is a folder of notes — see guard.ts.
			appendSystemPrompt: [VAULT_PROMPT],
			extensionFactories: [
				// The guard first: a blocked call never reaches the recorder.
				{ name: "guard", factory: guard(CWD, () => openNote) },
				// The one pair a note is written by — what the guard above sends
				// edit and write to when they reach for one. See noteEdit.ts.
				{ name: "notes", factory: noteTools(CWD, piWrote) },
				// pi's writes to notes go into their history as they happen, and the
				// tabs looking at a note hear about it.
				{ name: "recorder", factory: notes.factory },
				// A turn that answers about a chosen part of a note says it rather
				// than writing it; the answer is put in here — see ask.ts.
				{ name: "answering", factory: answering(() => asking !== null, answered) },
				// pi asking the person, answered in the browser — see askUser.ts.
				// The bridge is reached when a question is asked, not now: it is
				// made further down, after this first session is.
				{ name: "ask", factory: askUser(() => prompts.ask) },
			],
			// Only the five above. The packages in the person's own pi were
			// installed for its terminal, and one of them loaded here has cost a
			// second on every new session, registered nothing, and thrown inside
			// its own start; a session that fails to open then looks like
			// Octave's fault, and a tool that appears in one install and not
			// another is a tool nobody can be told about. So what pi loads from
			// ~/.pi/agent is not loaded, and what Octave brings is all there is.
			noExtensions: true,
		},
	});
	return {
		// No `model`: pi picks it the way the CLI does — the one the session was
		// on, else the persisted default (which set_model writes), else the first
		// with credentials. Choosing here would bypass the first two.
		...(await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
		})),
		services,
		diagnostics: services.diagnostics,
	};
};

const runtime = await createAgentSessionRuntime(createRuntime, {
	cwd: CWD,
	agentDir: getAgentDir(),
	// Persisted to ~/.pi/agent/sessions/, so a session survives a restart.
	sessionManager: SessionManager.create(CWD),
});

const session = () => runtime.session;

/** The model the session is on, or undefined when pi has only its stand-in — see isUnknownModel. */
const currentModel = () => {
	const model = session().model;
	return model && !isUnknownModel(model) ? model : undefined;
};

/** Derived from the session so it stays in sync; pi does not re-export ThinkingLevel. */
type ThinkingLevel = ReturnType<typeof session>["thinkingLevel"];

type AvailableModel = ReturnType<typeof availableModels>[number];

/**
 * A model as both the picker and the loadout screen show it.
 *
 * The level named beside a model has to be the one that choosing it will get:
 * what the session is thinking at for the model it is on, and for the rest what
 * pi would put them back on — its own memory of that model, else the default it
 * falls back to — clamped, since pi clamps on the way in and neither screen may
 * name a level the model will not do.
 */
function modelInfo(m: AvailableModel, current: string | null): ModelInfo {
	const s = session();
	const settings = s.settingsManager;
	const key = modelKey(m);
	const levels = supportedLevels(m);
	const level =
		key === current
			? s.thinkingLevel
			: clampLevel(levels, settings.getModelThinkingLevel(m.provider, m.id) ?? settings.getDefaultThinkingLevel() ?? s.thinkingLevel);
	return { key, name: m.name, levels, level };
}

/**
 * Every model pi can reach, for the screen that chooses a loadout from them.
 *
 * Over HTTP rather than in the config broadcast: it is fifty-odd entries that
 * change when credentials do, and config goes out on every keystroke's worth of
 * streaming state. The screen that needs it is a modal, so it cannot go stale
 * while it is being read.
 */
function catalog(): ModelInfo[] {
	const model = currentModel();
	const current = model ? modelKey(model) : null;
	return availableModels().map((m) => modelInfo(m, current));
}

/** Everything the settings UI needs. Re-sent whenever any of it changes. */
function config(): ConfigMsg {
	const s = session();
	const model = currentModel();
	const current = model ? modelKey(model) : null;
	const offered = new Map(availableModels().map((m) => [modelKey(m), m]));
	// The model the session is on belongs on the list even when the snapshot has
	// left it out — see availableModels. Without this the picker could show the
	// session running on nothing.
	if (model && current) offered.set(current, model);
	return {
		type: "config",
		model: current,
		models: loadoutOf(readSettings().loadout, [...offered.keys()], current).flatMap((key) => {
			const m = offered.get(key);
			return m ? [modelInfo(m, current)] : [];
		}),
		modelsNotice,
		tools: s.getAllTools().map((tool) => ({ name: tool.name, description: tool.description })),
		activeTools: s.getActiveToolNames(),
		isStreaming: s.isStreaming,
		queued: {
			steering: [...s.getSteeringMessages()],
			followUp: [...s.getFollowUpMessages()],
		},
		sessionId: s.sessionId,
		sessionName: s.sessionName ?? null,
		folder: CWD,
		log: logFile,
	};
}

/**
 * Token spend and context pressure. pi tracks both; without surfacing them the
 * user has no idea what a turn costs or how close the session is to overflowing.
 */
function usage(): UsageMsg {
	const stats = session().getSessionStats();
	const context = session().getContextUsage();
	return {
		type: "usage",
		cost: stats.cost,
		tokens: stats.tokens,
		messages: stats.totalMessages,
		toolCalls: stats.toolCalls,
		context: context ? { tokens: context.tokens, window: context.contextWindow, percent: context.percent } : null,
	};
}

/**
 * The conversation so far, in the same item shape the client builds from live
 * events. A resumed session has history but emits no events for it, so without
 * this the browser would show an empty conversation.
 */
function snapshot(): SnapshotMsg {
	// The same objects, not copies: pi hands the message the agent holds to the
	// session file — "keeps agent state ... and persistence in sync", as it puts
	// it — so identity is what ties a message on screen to its place in the tree.
	// Position would work today and break the day one of them is filtered.
	const ids = new Map<unknown, string>();
	for (const entry of session().sessionManager.buildContextEntries()) {
		if (entry.type === "message") ids.set(entry.message, entry.id);
	}
	return { type: "snapshot", items: itemsFromMessages(session().messages, (message: unknown) => ids.get(message)) };
}

/**
 * What fills the context window besides the conversation, as sizes. pi counts
 * only the total, after each response; these let the client estimate the
 * fixed parts the way pi itself estimates — four characters a token. Sent when
 * a session is built and when the tools or model change, not per message.
 */
function contextSources(): ContextSourcesMsg {
	const s = session();
	const active = new Set(s.getActiveToolNames());
	const loader = runtime.services.resourceLoader;
	const provider = currentModel()?.provider;
	const files = loader.getAgentsFiles().agentsFiles;
	return {
		type: "context_sources",
		systemPromptChars: s.systemPrompt.length,
		tools: s.getAllTools().map((tool) => ({
			name: tool.name,
			chars: JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length,
			active: active.has(tool.name),
		})),
		skills: loader.getSkills().skills.length,
		memoryFiles: { count: files.length, chars: files.reduce((n, f) => n + f.content.length, 0) },
		login: {
			oauth: provider ? modelRuntime.isUsingOAuth(provider) : false,
			subscription: provider ? modelRuntime.isUsingSubscription(provider) : false,
		},
	};
}

/**
 * The providers, as pi's /login screen lists them: which can be signed in to
 * from here, and which are signed in. Read fresh from pi each time, since it
 * is pi that reads the credentials file.
 */
function providers(): ProvidersMsg {
	return {
		type: "providers",
		providers: modelRuntime
			.getProviders()
			.flatMap((p) => {
				const status = modelRuntime.getProviderAuthStatus(p.id);
				// pi's own read of its file, for the key's tail; only a key pi keeps
				// has one to show, and pi says so with source "stored".
				const kept = status.source === "stored" ? readStoredCredential(p.id) : undefined;
				const key = kept?.type === "api_key" ? kept.key : undefined;
				return providerInfo(p, status, modelRuntime.isUsingOAuth(p.id), key) ?? [];
			}),
	};
}

/**
 * Where the conversation on screen has alternatives. See branches.ts, which
 * holds the tree reading so it can be tested against a session built on purpose.
 */
function branches(): BranchesMsg {
	return { type: "branches", nodes: branchPoints(session().sessionManager) };
}

/** The notes in the working folder. See vault.ts. */
function files(): FilesMsg {
	return { type: "files", files: notes.all(), truncated: notes.truncated };
}

/**
 * Bring a note's log up to what is on disk, asking whose the difference is.
 *
 * Every place that settles the disk goes through here, because the answer is
 * the same question everywhere. pi's, if its shell was running and this is
 * what it did — which only the recorder knows (recorder.ts). Else outside's,
 * if the note is one the folder did not have when the app listed it: it
 * appeared while the app was running, so every word of it was written by
 * someone, just now, and not through here. Else what the log makes of it —
 * a difference from what it knew is outside's, and a note it never knew is
 * from before (reconcile).
 */
function settleDisk(path: string, text: string, mtime: number, at: number) {
	const origin: Origin | undefined = claimant?.(path, mtime) ?? (notes.has(path) ? undefined : { author: "outside", at });
	return reconcile(CWD, path, text, at, origin);
}

/**
 * One note, with who wrote what. Opening it also brings its history up to the
 * disk: an edit made outside the app is logged as such here, before anything
 * is drawn or measured against it.
 */
function note(path: string): NoteMsg | null {
	const found = readNote(CWD, path);
	if (!found) return null;
	const { holed } = settleDisk(path, found.text, found.modified, Date.now());
	known.set(path, found.modified);
	return { type: "note", path, text: found.text, modified: found.modified, original: toDecide(holed), backlinks: links.backlinks(path), tagged: links.tagged(path) };
}

/**
 * A note being made now, as it starts out: with when it was made written in
 * it, unless that has been turned off. Only at the making — a note restored
 * from the trash or noticed on disk was made some other time, and one that
 * already says so keeps what it says (vault.ts).
 */
const born = (text: string) => (readSettings().created ? withCreated(text, new Date()) : text);

// The app's folder, and what git should keep of it — see appDir.ts.
claimAppDir(CWD);

/** Which notes the folder holds, so that a save does not read the folder again — see fileIndex.ts. */
const notes = new FileIndex(CWD);
notes.load();

/** Every note's links, for "who links here" — see linkIndex.ts. */
const links = new LinkStore(CWD);
links.load();

/** What kind of thing each property holds, where someone has chosen — see propertyRegistry.ts. */
const propertyTypes = new PropertyRegistry(CWD);
propertyTypes.load();

/** What the vault's notes call their properties, for the boxes that offer them — see propertyIndex.ts. */
const propertyNames = new PropertyStore(CWD);
propertyNames.load();

/**
 * The vault has something else to offer, or one thing less: every tab hears
 * the names again. Only when they differ — a write that changed a body alone
 * leaves the boxes saying what they said.
 */
function offered(changed: boolean): void {
	if (changed) broadcast({ type: "property_names", ...propertyNames.all() });
}

/** After a change to what links where: the notes whose backlinks may differ hear theirs again. */
function backlinksFor(paths: string[]): void {
	for (const path of paths) broadcast({ type: "backlinks", path, notes: links.backlinks(path) });
}

/** After a change to what links where or what is tagged how: everyone whose lists may differ hears them again. */
function touchedBy(touched: Touched): void {
	backlinksFor(touched.backlinks);
	for (const path of touched.tagged) broadcast({ type: "tagged", path, notes: links.tagged(path) });
}

/**
 * The version of each note the tabs were last told about — its mtime the
 * last time this process read or wrote it. What a change noticed on disk is
 * measured against, and how the watcher's report of the app's own write is
 * told from someone else's: the version it reports is the one already here.
 */
const known = new Map<string, number>();

/**
 * The disk changed under a note, and not by this process: pi's bash, another
 * editor. Logged to whoever it belongs to and sent on as a change over the
 * version the tabs have, the same as any other write — or whole, if no tab
 * could have a version of it yet. A note that is gone is only news to the list.
 */
function noticed(path: string): void {
	const found = readNote(CWD, path);
	if (!found) {
		// Gone from under a tab that had it: news. Gone after the app itself
		// moved it — a rename, a delete — is already told, and known forgets
		// it first.
		if (known.delete(path)) broadcast({ type: "note_gone", path });
		touchedBy(links.remove(path));
		offered(propertyNames.remove(path));
		if (notes.remove(path)) broadcast(files());
		return;
	}
	const base = known.get(path) ?? null;
	if (base === found.modified) return; // This process's own write, already sent.
	const { appended } = settleDisk(path, found.text, found.modified, Date.now());
	// Touched but not changed still moves the version the next save is measured against.
	wrote(path, base, appended);
}

/**
 * After a write through the app: every tab gets the change, and the list its
 * new order. A note that did not exist has no version to have been written
 * over, and goes out whole instead; so does one whose history says something
 * other than the disk, which is not a state a change can be measured from.
 */
function wrote(path: string, base: number | null, changes: Change[]): void {
	const found = readNote(CWD, path);
	if (found) {
		touchedBy(links.update(path, found.text));
		offered(propertyNames.update(path, found.text));
	}
	// One read of the log for both questions — whether it agrees with the disk,
	// and what is left to decide about — and the snapshot beside it means the
	// walk is only what has been written since. See historyOf.
	const said = found ? historyOf(CWD, path) : null;
	if (found && said && base !== null && said.replayed.text === found.text) {
		known.set(path, found.modified);
		const msg: NoteChangedMsg = { type: "note_changed", path, base, modified: found.modified, changes, original: toDecide(said.holed) };
		broadcast(msg);
	} else {
		const msg = note(path);
		if (msg) broadcast(msg);
	}
	// The list only hears about a note it did not have. A note's text changing
	// is not something anything reading that list can see — see fileIndex.ts.
	const news = found ? notes.saw(path, found.modified) : notes.remove(path);
	if (news) broadcast(files());
}

/**
 * What is left to decide about in a note, as the text it would be with pi's
 * undecided changes put back — or nothing, when there are none. Read off the
 * log each time it is asked, so it is never stale and nothing about a run
 * has to be remembered: a diff is available whenever there is one to show,
 * to whichever tab opens the note, however long ago pi wrote.
 */
function toDecide(holed: Holed): string | undefined {
	const { before, holes } = undecided(holed);
	return holes.length ? before : undefined;
}

/** End the ask in flight, whatever came of it, and stop waiting for an answer. */
function settle(outcome: AskOutcome): void {
	const ask = asking;
	asking = null;
	ask?.done(outcome);
}

/**
 * Take an ask, or say why not, and give back the question pi is sent: the
 * chosen words as a quote, then what was asked about them.
 *
 * Where the log stands now is kept with it. That is the mark the answer's
 * place is measured from — everything appended after it is what the note did
 * while pi thought.
 */
function beginAsk(ask: Ask, question: string, tab: WebSocket): string | null {
	if (typeof ask.id !== "number" || typeof ask.path !== "string" || typeof ask.from !== "number" || typeof ask.to !== "number") return null;
	const done = (outcome: AskOutcome) => {
		// The tab may be gone by the time the answer is. The answer still goes
		// into the note; there is simply nobody left to tell about it.
		if (tab.readyState === tab.OPEN) tab.send(safeStringify({ type: "ask_done", id: ask.id, outcome }));
	};
	const refuse = (outcome: AskOutcome): null => {
		done(outcome);
		return null;
	};
	if (asking || session().isStreaming) return refuse("interrupted");
	const found = readNote(CWD, ask.path);
	if (!found) return refuse("gone");
	if (!(ask.from >= 0 && ask.to > ask.from && ask.to <= found.text.length)) return refuse("gone");
	asking = { ...ask, at: readHistory(CWD, ask.path).length, done };
	return asked(found.text.slice(ask.from, ask.to), question);
}

/**
 * A note as pi leaves it, by the path every write takes: the file, then the
 * log, then the tabs.
 *
 * `had` is the note as it was read a moment ago — what the change is measured
 * from, and the version the write is refused over if the person has typed past
 * it since. Null for a note that is not there yet. The same shape as the
 * editor's own save, which is the point: pi's writing is held to what a
 * person's is, and marked until they accept it.
 */
function piWrote(path: string, had: Note | null, given: string, sessionId: string, entryId?: string): WriteResult {
	// A note pi makes is a note made here, and says when as any other does.
	const text = had ? given : born(given);
	const written = writeNote(CWD, path, text, had?.modified ?? null);
	if (!written.ok) return written;
	const changes = record(CWD, path, had?.text ?? "", text, { author: "pi", at: Date.now(), sessionId, entryId });
	wrote(path, had?.modified ?? null, changes);
	return written;
}

/**
 * pi's words, put into the note under the line the words at `to` end on.
 *
 * The person asking for them to be put there does not make them theirs; what
 * it makes is the moment they land, which is why this is a write of pi's made
 * on a person's word.
 */
function putUnder(path: string, to: number, words: string, sessionId: string, entryId?: string): boolean {
	const found = readNote(CWD, path);
	if (!found) return false;
	return piWrote(path, found, under(found.text, to, words), sessionId, entryId).ok;
}

/**
 * pi's answer to the ask in flight, put into the note under what was asked
 * about.
 *
 * The note has moved on while pi thought — the person kept typing, and their
 * saves are in the log — so the place is mapped through the changes since, the
 * way the editor maps its own around a write.
 */
function answered(answer: string | null, sessionId: string, entryId?: string): void {
	const ask = asking;
	if (!ask) return;
	if (!answer) return settle("failed");
	const found = readNote(CWD, ask.path);
	if (!found) return settle("gone");
	// Settle what the disk says first: a write that missed the app belongs in
	// the log ahead of this one, and moves the place along with it.
	reconcile(CWD, ask.path, found.text, Date.now());
	const since = readHistory(CWD, ask.path).slice(ask.at);
	const to = mapThrough(since, ask.to);
	// The two ends meet when what was chosen was replaced whole: it is not
	// there to answer under any more.
	if (mapThrough(since, ask.from) >= to) return settle("gone");
	settle(putUnder(ask.path, to, answer, sessionId, entryId) ? "written" : "failed");
}

/** Saved sessions for this working directory, newest first. */
/**
 * The model a turn was on, and the message it began with, out of pi's own
 * record of the conversation.
 *
 * Its entries are a tree and the log holds the id of the one that was being
 * written at the time, so the branch down to it is the turn's own history:
 * the last model it was told to use, and the last thing the person said
 * before it. Nothing here is ours — a session can be deleted, and then this
 * says nothing rather than guessing.
 */
async function turnOf(sessionId?: string, entryId?: string): Promise<{ model?: string; prompt?: string }> {
	if (!sessionId || !entryId) return {};
	try {
		const info = (await SessionManager.list(CWD)).find((s) => s.id === sessionId);
		if (!info) return {};
		const manager = await SessionManager.open(info.path);
		const branch = manager.getBranch(entryId);
		if (!Array.isArray(branch)) return {};
		let model: string | undefined;
		let prompt: string | undefined;
		for (const entry of branch) {
			if (entry.type === "model_change" && entry.modelId) model = entry.provider ? `${entry.provider}/${entry.modelId}` : entry.modelId;
			if (entry.type === "message" && entry.message?.role === "user") prompt = textOf(entry.message.content).trim() || undefined;
		}
		return { ...(model ? { model } : {}), ...(prompt ? { prompt } : {}) };
	} catch {
		// A session that will not open is a session that has nothing to say here.
		return {};
	}
}

async function sessions(): Promise<SessionsMsg> {
	const current = session().sessionFile;
	const list = (await SessionManager.list(CWD))
		.sort((a, b) => b.modified.getTime() - a.modified.getTime())
		.map((info) => ({
			path: info.path,
			id: info.id,
			name: info.name ?? null,
			modified: info.modified.toISOString(),
			messageCount: info.messageCount,
			firstMessage: info.firstMessage.slice(0, 80),
			current: info.path === current,
		}));

	// An empty session has no file on disk yet, so it is missing from the list.
	// Without a placeholder the picker would show a different session as selected.
	if (current && !list.some((s) => s.current)) {
		list.unshift({
			path: current,
			id: session().sessionId,
			name: session().sessionName ?? null,
			modified: new Date().toISOString(),
			messageCount: 0,
			firstMessage: "(new session)",
			current: true,
		});
	}
	return { type: "sessions", sessions: list };
}

/**
 * abort() waits for the agent to go idle, and a tool that never returns never
 * lets it. The known case — an extension tool waiting on a question — is now
 * handled by cancelling open questions first (prompts.cancelAll), which lets
 * the tool finish and the abort go through. This is the fallback for whatever
 * else might hang, and for when the extension's hook is missing: giving up on
 * the abort is worse than a stuck tool but better than a stuck server.
 */
async function abortWithin(ms: number): Promise<void> {
	const timedOut = Symbol("timeout");
	const timer = new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), ms));
	if ((await Promise.race([session().abort(), timer])) === timedOut) {
		console.error(`abort did not finish within ${ms}ms — a tool is not responding`);
	}
}

const clients = new Set<WebSocket>();

function broadcast(payload: ServerMsg): void {
	const text = safeStringify(payload);
	for (const client of clients) {
		if (client.readyState === client.OPEN) client.send(text);
	}
}

const prompts = createPromptBridge(broadcast);

/**
 * Signing in, through pi — see login.ts. A URL pi wants opened goes to the
 * shell when there is one (electron/main.js opens it in the person's browser);
 * in a terminal run the tab shows it and the person clicks.
 */
const logins = createLoginBridge(
	broadcast,
	(provider, method, interaction) => modelRuntime.login(provider, method, interaction),
	process.send ? (url) => process.send!({ ask: "open", url }) : null,
);

/**
 * After a sign-in: bring the models up to date, and — when the session was on
 * nothing — put it on one of the new provider's, as pi's CLI does after its
 * own login (completeProviderAuthentication). pi's CLI takes the provider's
 * named default; that table is not exported, so this takes what the picker
 * would show first for the provider — the loadout, which until someone
 * chooses is the newest models (SEED_LOADOUT) — and failing that the first
 * the provider offers, which is its oldest. A session already on a model is
 * left on it.
 */
async function afterSignIn(provider: string): Promise<void> {
	await refreshModels();
	if (!currentModel()) {
		const offered = availableModels().filter((m) => m.provider === provider);
		const keys = offered.map(modelKey);
		const preferred = loadoutOf(readSettings().loadout, keys, null).find((key) => keys.includes(key));
		const pick = offered.find((m) => modelKey(m) === preferred) ?? offered[0];
		if (pick) await session().setModel(pick, { persist: true });
	}
	broadcast(config());
	broadcast(contextSources());
}

/**
 * The wire form of a session event, matching what pi's own print and rpc modes
 * send. A `message_update` ships the whole message being streamed twice — as
 * `message` and again as `assistantMessageEvent.partial` — and both are
 * reconstructible from the deltas the client already folds in. Dropping them
 * keeps the raw view readable at 300 events.
 */
function toWireEvent(event: AgentSessionEvent): PiEventMsg {
	if (event.type !== "message_update") return event as unknown as PiEventMsg;
	const usage = event.message.role === "assistant" ? event.message.usage : undefined;
	const sub = event.assistantMessageEvent;
	if (!("partial" in sub)) return { type: event.type, usage, assistantMessageEvent: sub };
	const { partial: _partial, ...delta } = sub;
	return { type: event.type, usage, assistantMessageEvent: delta };
}

/**
 * Whether the run in flight was a question asked again.
 *
 * Such a run makes a branch, and the arrows that reach it hang off the new
 * question's place in the session tree. A conversation folded from live events
 * cannot know that place — pi puts it in the session file and emits nothing
 * that carries it — so when that run settles the conversation is read back
 * from the file once. Only then: a snapshot replaces the conversation, and
 * with it the notices that exist only live, like a retry that explained a
 * silence, so it is not worth doing after runs that made no branch.
 */
let rereadWhenSettled = false;

function onEvent(event: AgentSessionEvent): void {
	broadcast(toWireEvent(event));
	// isStreaming and the queue drive the stop button and pending count.
	if (event.type === "agent_start" || event.type === "agent_settled" || event.type === "queue_update") {
		broadcast(config());
	}
	// Cost only moves when a message completes.
	if (event.type === "message_end" || event.type === "agent_settled") broadcast(usage());
	if (event.type === "agent_settled" && rereadWhenSettled) {
		rereadWhenSettled = false;
		broadcast(snapshot());
	}
	// A finished run is a new branch under whatever it was asked from, so the
	// message it answered may have just gained a sibling.
	if (event.type === "agent_settled") broadcast(branches());
	// And it may have written a note, or renamed one, by a route nothing here
	// hears — a shell command. One walk at the end of a turn, and only if what
	// it found differs.
	if (event.type === "agent_settled" && notes.load()) broadcast(files());
	// The first exchange is the first thing there is to name the session by.
	if (event.type === "agent_settled") void nameSession();
}

/**
 * The session a name has already been asked for. Once per conversation: a
 * model that gave nothing back for this exchange will not give something back
 * for the same one, and a second try would only spend again to say so.
 */
let namedFor: string | null = null;

/**
 * Give a name to a conversation nobody has named — see sessionName.ts. Run
 * when a turn ends, which is the first moment there is anything to go on.
 *
 * A name already there is never replaced. pi keeps one name, so a name put
 * there by a person and a name put there by this are the same field; leaving
 * whatever is there alone is what keeps this from talking over anybody.
 */
async function nameSession(): Promise<void> {
	const named = session();
	if (named.sessionName || namedFor === named.sessionId) return;
	const messages = named.messages;
	const question = messages.find((m) => m.role === "user");
	const answer = messages.find((m) => m.role === "assistant");
	if (!question || !answer) return;
	namedFor = named.sessionId;
	try {
		const name = await askForName({
			cwd: CWD,
			agentDir: getAgentDir(),
			modelRuntime,
			models: availableModels(),
			question: textOf(question.content),
			answer: textOf(answer.content),
		});
		// Thinking of a name takes a moment, and in that moment the session can
		// be replaced or named. Either way this answer is about a conversation
		// that is no longer the one being named.
		if (!name || session().sessionId !== named.sessionId || session().sessionName) return;
		session().setSessionName(name);
		broadcast(config());
		broadcast(await sessions());
	} catch {
		// A courtesy. Without it the first message stands in for a name, which
		// is what it did before there was anything to name a conversation with.
	}
}

let unsubscribe: (() => void) | undefined;

/** Rebind after the runtime swaps in a different AgentSession. */
async function bind(): Promise<void> {
	unsubscribe?.();
	await session().bindExtensions({});
	unsubscribe = session().subscribe(onEvent);
}

/**
 * Open a new session on a mode rather than on pi's four-tool default.
 *
 * pi persists the model and the thinking level when asked to, but not the
 * active tools: setActiveToolsByName takes no `persist`, and `defaultTools` in
 * its settings has a getter and no setter. Tool activation is session-scoped
 * there by design, so this picks the same mode every time instead of carrying
 * one over — no second settings store, and nothing to get out of step with pi's.
 *
 * Resumed sessions are left alone: they open the way they were left.
 */
function openOnDefaultMode(): void {
	const available = session()
		.getAllTools()
		.map((tool) => tool.name);
	session().setActiveToolsByName(modeToolNames(readSettings().toolMode, available));
}

/** Push the full server state to every client. Used after a session is replaced. */
async function broadcastAll(): Promise<void> {
	broadcast(config());
	broadcast(usage());
	broadcast(contextSources());
	broadcast(snapshot());
	broadcast(branches());
	broadcast(files());
	broadcast(await sessions());
}

await bind();
openOnDefaultMode();

// No model is how a first run begins, and pi's own CLI begins the same way:
// the session opens on nothing and the login dialog is the first thing shown.
// The server stays up for the same reason, and says so beside the picker (see
// modelsNotice); a prompt sent meanwhile is refused by pi with its own words.
if (!currentModel()) console.error("No model has usable credentials yet; waiting for a sign-in.");

/**
 * Keeping the model list true.
 *
 * pi builds the list by reading each provider's credential, and leaves out
 * without a word any it cannot read at that moment. The file they all live in
 * is rewritten whole whenever an OAuth token is renewed, so a pass that reads
 * it mid-write comes back a provider short — and this process, unlike pi's
 * CLI, does not run the pass again on its own. It ran once at startup, and
 * one bad moment then was the list for days. See models.ts.
 *
 * So the pass is run again when the list can have gone stale: the
 * credentials file changed, or a tab connected. One pass at a time; a second
 * ask while one runs joins it. A pass that ends with pi reporting trouble, or
 * with a provider gone that was there a moment ago, is followed by one more
 * after a pause, since the likeliest reason is the file mid-write. Meanwhile
 * the tabs are told why the list may be short, rather than shown a short
 * list as if it were the whole of it.
 */
let modelsNotice: string | undefined = modelsNotice_([], undefined, availableModels().map(modelKey));
let refreshing: Promise<void> | null = null;
let lookedAgain = 0;
/** The providers as last announced, so a pass that moved none says nothing. */
let providersSaid = JSON.stringify(providers().providers);

function refreshModels(): Promise<void> {
	if (refreshing) return refreshing;
	const before = availableModels().map(modelKey);
	refreshing = (async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		try {
			await modelRuntime.refresh({ signal: controller.signal });
		} catch {
			// What went wrong is in getError(), read below.
		} finally {
			clearTimeout(timeout);
		}
		const after = availableModels().map(modelKey);
		const notice = modelsNotice_(lostProviders(before, after), modelRuntime.getError(), after);
		const changed = notice !== modelsNotice || after.join() !== before.join();
		modelsNotice = notice;
		if (changed) broadcast(config());
		// Signing in and out moves this list more often than the model list —
		// a key that reaches no model is a provider signed in with nothing
		// offered — so it is judged on its own.
		const now = providers();
		const said = JSON.stringify(now.providers);
		if (said !== providersSaid) {
			providersSaid = said;
			broadcast(now);
		}
		if (notice && lookedAgain < 2) {
			lookedAgain++;
			setTimeout(() => void refreshModels(), 3_000);
		} else if (!notice) lookedAgain = 0;
	})().finally(() => {
		refreshing = null;
	});
	return refreshing;
}

// As pi's rpc mode does after startup: bring the model catalogues up to date in
// the background, and tell the clients if that changed what is on offer.
void refreshModels();

// The credentials file is what a pass reads, so a change to it is the one sure
// sign the list can have moved. It is replaced whole on a token renewal, which
// a watch on the file itself does not survive, so the folder is watched and
// the name matched. A renewal writes more than once in quick succession; the
// pass runs when that has settled.
{
	let settle: ReturnType<typeof setTimeout> | null = null;
	try {
		watch(getAgentDir(), (_event, name) => {
			if (name !== "auth.json") return;
			if (settle) clearTimeout(settle);
			settle = setTimeout(() => void refreshModels(), 750);
		});
	} catch {
		// No folder yet, or a platform without watching: the other reasons to
		// look again still apply.
	}
}

/**
 * Where `npm run build` puts the client. Absent until it has been run once.
 *
 * The desktop shell runs a bundled copy of this file from another directory, so
 * it says where the client is rather than letting the path be inferred from
 * wherever the module happens to sit.
 */
const CLIENT_DIR = process.env.CLIENT_DIR
	? pathToFileURL(process.env.CLIENT_DIR.replace(/\/?$/, "/"))
	: new URL("dist/", import.meta.url);

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".map": "application/json; charset=utf-8",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};


/** A small request body, whole. Capped: the one endpoint that takes one takes a few fields. */
function text(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let out = "";
		req.on("data", (chunk) => {
			out += chunk;
			if (out.length > 4096) reject(new Error("too large"));
		});
		req.on("end", () => resolve(out));
		req.on("error", reject);
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	const { pathname } = url;

	if (pathname.startsWith("/api/")) {
		const json = (code: number, body: unknown) => {
			res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
			res.end(JSON.stringify(body));
		};
		// The settings, all of them at once. Sent whole rather than a field at a
		// time because that is what settings.ts writes; a field it did not hear
		// about would come back as its default and quietly undo an edit.
		if (pathname === "/api/settings" && req.method === "POST") {
			try {
				const written = writeSettings(JSON.parse(await text(req)));
				// The loadout lives here and is drawn on the composer, which hears about
				// it on the socket rather than by asking — so a change made on this
				// screen has to be announced, or the picker keeps the old list until
				// something else happens to move it.
				broadcast(config());
				return json(200, written);
			} catch {
				return json(400, { error: "invalid JSON" });
			}
		}
		if (req.method !== "GET") return json(405, { error: "read only" });
		if (pathname === "/api/settings") return json(200, readSettings());
		if (pathname === "/api/models") return json(200, catalog());
		return json(404, { error: "not found" });
	}

	// The build hashes its asset names, so the set of files cannot be listed
	// ahead of time the way the two hand-written ones could be.
	const file = new URL(pathname === "/" ? "index.html" : pathname.slice(1), CLIENT_DIR);
	// A path can climb out of dist/ with ..; resolving first and comparing after
	// is the only check that survives whatever encoding it arrives in.
	if (!file.pathname.startsWith(CLIENT_DIR.pathname)) {
		res.writeHead(404).end("Not found");
		return;
	}
	let body: Buffer;
	try {
		body = await readFile(file);
	} catch {
		if (pathname === "/") console.error("no dist/ yet — run `npm run build`, or use the vite dev server");
		res.writeHead(404).end("Not found");
		return;
	}
	const ext = file.pathname.slice(file.pathname.lastIndexOf("."));
	res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
	res.end(body);
});

const wss = new WebSocketServer({ server });

wss.on("connection", async (ws) => {
	clients.add(ws);
	// Someone is looking: a list that has gone stale since the last pass is
	// brought up to date, and this tab hears of it like every other.
	void refreshModels();
	ws.on("close", () => clients.delete(ws));
	// ws emits 'error' for a malformed frame. Node throws on an 'error' event
	// with no listener, so without this one bad frame takes the process down.
	ws.on("error", (err) => {
		console.error("websocket error:", err.message);
		clients.delete(ws);
	});
	/** To this tab only: answers to what it asked, and the state it needs to start. */
	const reply = (msg: ServerMsg) => ws.send(safeStringify(msg));
	reply(config());
	reply(providers());
	reply(usage());
	reply(contextSources());
	reply(snapshot());
	reply(branches());
	notes.load();
	reply(files());
	reply({ type: "property_types", types: propertyTypes.all() });
	reply({ type: "property_names", ...propertyNames.all() });
	// A tab opened while a question is waiting should see it too.
	for (const prompt of prompts.open()) reply({ type: "prompt_request", prompt });
	const asking = logins.open();
	if (asking) reply({ type: "login_prompt", prompt: asking });

	ws.on("message", async (data) => {
		// Typed as what the browser sends, which is what lets each case below
		// read its own fields. Not trusted as that: it came over a socket, so
		// each case still checks the field it is about to hand to pi.
		let msg: ClientMsg;
		try {
			msg = JSON.parse(data.toString());
		} catch {
			reply({ type: "error", message: "invalid JSON from client" });
			return;
		}
		try {
			switch (msg.type) {
				case "prompt": {
					if (typeof msg.text !== "string") return;
					openNote =
						typeof msg.note === "string"
							? { path: msg.note, chosen: typeof msg.chosen === "string" && msg.chosen ? msg.chosen : null }
							: null;
					// Anything else said to pi takes the waiting answer with it: after
					// this, which reply was the answer cannot be told, and a guess
					// would write the wrong words into someone's note.
					if (!msg.ask) settle("interrupted");
					// An ask is the same message with what it is about attached; what
					// pi is sent is the chosen words quoted above the question.
					let text = msg.text;
					if (msg.ask) {
						const question = beginAsk(msg.ask, msg.text, ws);
						if (question === null) return;
						text = question;
					}
					// Asking an earlier question again: move the leaf to just before
					// it, so what is sent next becomes a sibling of it rather than a
					// reply to it, and the branch it was on is left where it is.
					//
					// Both halves happen here rather than as two commands from the
					// browser, because between them the conversation is one question
					// short and nothing is being asked. Nothing should be able to
					// arrive in that gap, and nobody should have to look at it.
					if (typeof msg.entryId === "string") {
						if (session().isStreaming) {
							reply({ type: "error", message: "Wait for the reply to finish before asking again." });
							return;
						}
						const moved = await session().navigateTree(msg.entryId);
						if (moved.cancelled) return;
						// The screen still shows the question about to be replaced, so
						// the shortened conversation goes out before the new one starts.
						await broadcastAll();
						rereadWhenSettled = true;
					}
					// "steer" redirects the run in progress; "followUp" waits for it to finish.
					const behavior = msg.behavior === "steer" ? "steer" : "followUp";
					try {
						// prompt() throws if the session is streaming and no behavior is given.
						await session().prompt(
							text,
							session().isStreaming ? { streamingBehavior: behavior } : undefined,
						);
					} catch (err) {
						// A prompt that never started a run never settles, and the next
						// run — which made no branch — would reread the file for it.
						rereadWhenSettled = false;
						// Nor is there a run left to answer an ask that went with it.
						settle("failed");
						throw err;
					}
					break;
				}

				case "abort":
					prompts.cancelAll();
					// The run that was to answer is being stopped; nothing goes in.
					settle("interrupted");
					await abortWithin(5000);
					broadcast(config());
					break;

				case "clear_queue": {
					// pi clears the queue whole or not at all: there is no removing one
					// message. Re-queueing the survivors is not a substitute, because
					// steer() expands skill commands and templates again over text it
					// already expanded once, and throws outright on an extension command.
					//
					// Nothing is lost by clearing: the messages come back, and go to the
					// tab that asked so they land in the box it was typed in. Every tab
					// learns the queue is empty from the queue_update this emits.
					const cleared = session().clearQueue();
					reply({ type: "queue_cleared", ...cleared });
					break;
				}

				case "set_tools":
					if (!Array.isArray(msg.names)) return;
					// Takes effect on the next turn, not the one in flight.
					session().setActiveToolsByName(msg.names);
					broadcast(config());
					broadcast(contextSources());
					break;

				case "set_model": {
					let next = availableModels().find((m) => modelKey(m) === msg.model);
					if (!next && typeof msg.model === "string") {
						// The snapshot may be the truncated one described at
						// availableModels. Asking for one provider returns that
						// provider's list directly, not the snapshot, so it cannot
						// be truncated the same way.
						const provider = msg.model.slice(0, msg.model.indexOf("/"));
						if (provider) next = (await modelRuntime.getAvailable(provider)).find((m) => modelKey(m) === msg.model);
					}
					if (!next) {
						reply({ type: "error", message: `unknown model: ${msg.model}` });
						return;
					}
					// Throws when the model has no configured auth. Thinking level is
					// clamped to the new model, so the config broadcast reflects that too.
					// persist writes it to pi's own settings, so the next session — here
					// or in the CLI — opens on it; without it the choice lasts one session.
					await session().setModel(next, { persist: true });
					broadcast(config());
					broadcast(contextSources());
					break;
				}

				case "login": {
					if (typeof msg.provider !== "string" || (msg.method !== "oauth" && msg.method !== "api_key")) return;
					const known = providers().providers.find((p) => p.id === msg.provider);
					if (!known?.methods.includes(msg.method)) {
						reply({ type: "error", message: `${msg.provider} cannot be signed in to with ${msg.method === "oauth" ? "OAuth" : "an API key"} here.` });
						return;
					}
					const busy = logins.busy();
					if (busy) {
						reply({ type: "error", message: `Already signing in to ${busy}. Finish or cancel that first.` });
						return;
					}
					// Waits for the whole sign-in, and that is fine: each message from
					// the socket is its own event, so the answers arrive meanwhile.
					if (await logins.start(msg.provider, msg.method)) await afterSignIn(msg.provider);
					break;
				}

				case "login_answer":
					if (msg.cancelled === true) logins.cancel();
					else if (typeof msg.id === "string" && typeof msg.value === "string") logins.answer(msg.id, msg.value, false);
					break;

				case "logout": {
					if (typeof msg.provider !== "string") return;
					// pi forgets the credential it kept; one it found elsewhere is left
					// where it was, and providers() will go on saying so.
					await modelRuntime.logout(msg.provider, { signal: AbortSignal.timeout(15_000) });
					await refreshModels();
					broadcast(config());
					broadcast(contextSources());
					break;
				}

				case "set_thinking": {
					// setThinkingLevel clamps rather than rejecting, so an unknown
					// value would silently become "off". Validate first.
					const model = currentModel();
					const levels = model ? supportedLevels(model) : [];
					if (typeof msg.level !== "string" || !levels.includes(msg.level as ThinkingLevel)) {
						reply({ type: "error", message: `unsupported thinking level: ${msg.level}` });
						return;
					}
					// Written against this model rather than as the default for every
					// model: each entry in the loadout carries its own level, and pi puts
					// a model back on the one it remembers when the session moves to it
					// — so persist:true here would flatten the lot to whichever was set
					// last. The default is left alone; it is what a model nobody has set
					// a level for still starts from.
					session().setThinkingLevel(msg.level as ThinkingLevel);
					if (model) session().settingsManager.setModelThinkingLevel(model.provider, model.id, msg.level as ThinkingLevel);
					broadcast(config());
					break;
				}

				case "new_session":
					// A run in progress would keep writing to the session being replaced.
					prompts.cancelAll();
					// And an ask waiting on it would take the next session's first
					// answer for its own.
					settle("interrupted");
					await abortWithin(5000);
					await runtime.newSession();
					await bind();
					openOnDefaultMode();
					await broadcastAll();
					break;

				case "resume_session": {
					if (typeof msg.path !== "string") return;
					// The current session may not be on disk yet; switching to it would fail.
					if (msg.path === session().sessionFile) return;
					const known = (await sessions()).sessions.some((s) => s.path === msg.path);
					if (!known) {
						reply({ type: "error", message: `unknown session: ${msg.path}` });
						return;
					}
					prompts.cancelAll();
					settle("interrupted");
					await abortWithin(5000);
					await runtime.switchSession(msg.path);
					await bind();
					await broadcastAll();
					break;
				}

				case "prompt_response":
					if (typeof msg.id !== "string") return;
					prompts.answer(msg.id, typeof msg.answer === "string" ? msg.answer : undefined, msg.cancelled === true);
					break;

				// Show a different branch of the session tree. Nothing is deleted:
				// the leaf moves and the conversation is rebuilt from the new path.
				case "navigate": {
					if (typeof msg.entryId !== "string") return;
					// navigateTree throws on this, and a rejection the browser can act
					// on is better than an error it has to read.
					if (session().isStreaming) {
						reply({ type: "error", message: "Wait for the reply to finish before moving." });
						return;
					}
					const result = await session().navigateTree(msg.entryId);
					if (result.cancelled) return;
					// navigateTree emits nothing a session subscriber can hear — pi's
					// own UI clears its screen and redraws from messages afterwards —
					// so the new path has to be published from here.
					await broadcastAll();
					// A user message navigated to comes back as text rather than as
					// history, so it can be asked again differently. It goes to the tab
					// that asked, like a cleared queue does, to land in the box it was
					// typed in.
					if (result.editorText) {
						reply({ type: "queue_cleared", steering: [result.editorText], followUp: [] });
					}
					break;
				}

				case "set_session_name":
					if (typeof msg.name !== "string") return;
					session().setSessionName(msg.name);
					broadcast(config());
					broadcast(await sessions());
					break;

				case "open_note": {
					if (typeof msg.path !== "string") return;
					const found = note(msg.path);
					if (!found) {
						reply({ type: "note_gone", path: msg.path });
						return;
					}
					reply(found);
					break;
				}

				// The editor's save. Refused rather than merged when the note has
				// moved on since it was read — see vault.ts — and recorded to the
				// note's history as mine when it lands.
				case "save_note": {
					if (typeof msg.path !== "string" || typeof msg.text !== "string") return;
					const base = typeof msg.base === "number" ? msg.base : null;
					const had = readNote(CWD, msg.path);
					const written = writeNote(CWD, msg.path, msg.text, base);
					if (!written.ok) {
						if (written.reason === "conflict") reply({ type: "note_conflict", path: msg.path, modified: written.modified });
						else if (written.reason === "missing") reply({ type: "note_gone", path: msg.path });
						else reply({ type: "error", message: `cannot save ${msg.path}` });
						return;
					}
					const changes = record(CWD, msg.path, had?.text ?? "", msg.text, { author: "me", at: Date.now() });
					wrote(msg.path, had?.modified ?? null, changes);
					break;
				}

				// An empty note, made now rather than on first save: the file is
				// the truth, so a note exists once it is on disk and not before.
				// Named Untitled; the title field is where it gets a name.
				case "new_note": {
					const existing = notes.paths();
					let path: string;
					if (typeof msg.name === "string") {
						const target = renameTarget("Untitled.md", msg.name);
						if ("error" in target) {
							reply({ type: "note_rename_failed", path: "", to: msg.name, reason: "invalid" });
							return;
						}
						path = target.to;
						if (existing.includes(path)) {
							reply({ type: "note_rename_failed", path: "", to: path, reason: "exists" });
							return;
						}
					} else {
						path = newNoteName(existing);
					}
					const text = born("");
					const written = writeNote(CWD, path, text, null);
					if (!written.ok) {
						reply({ type: "note_rename_failed", path: "", to: path, reason: "invalid" });
						return;
					}
					record(CWD, path, "", text, { author: "me", at: Date.now() });
					reply({ type: "note_created", path });
					wrote(path, null, []);
					break;
				}

				// A note's path is its name. The file and its history move together,
				// and the version the tabs hold moves with them, so the watcher's
				// report of the move is not taken for someone writing.
				case "set_property_type": {
					if (typeof msg.name !== "string" || (msg.propertyType !== null && !isPropertyType(msg.propertyType))) return;
					if (!propertyTypes.set(msg.name, msg.propertyType)) {
						reply({ type: "error", message: `the type of ${msg.name} is not for choosing` });
						return;
					}
					broadcast({ type: "property_types", types: propertyTypes.all() });
					return;
				}
				case "rename_note": {
					if (typeof msg.path !== "string" || typeof msg.to !== "string") return;
					const moved = renameNote(CWD, msg.path, msg.to);
					if (!moved.ok) {
						reply({ type: "note_rename_failed", path: msg.path, to: msg.to, reason: moved.reason });
						return;
					}
					if (msg.path !== msg.to) {
						moveHistory(CWD, msg.path, msg.to);
						const version = known.get(msg.path);
						known.delete(msg.path);
						if (version !== undefined) known.set(msg.to, version);
					}
					broadcast({ type: "note_renamed", from: msg.path, to: msg.to });
					notes.rename(msg.path, msg.to);
					broadcast(files());
					if (msg.path !== msg.to) {
						// The notes that linked to the old name now link to the new one,
						// as Obsidian does: each is rewritten as a write of the person's,
						// since the person asked for the rename, and goes out like one.
						const before = links.paths();
						const linking = backlinksOf(Object.fromEntries(before.map((p) => [p, links.linksOf(p)])), msg.path, before);
						links.rename(msg.path, msg.to);
						propertyNames.rename(msg.path, msg.to);
						for (const { path: other } of linking) {
							const had = readNote(CWD, other);
							if (!had) continue;
							const text = retarget(had.text, msg.path, msg.to, before, other);
							if (text === null) continue;
							const written = writeNote(CWD, other, text, had.modified);
							if (!written.ok) continue;
							const changes = record(CWD, other, had.text, text, { author: "me", at: Date.now() });
							wrote(other, had.modified, changes);
						}
						backlinksFor([msg.to]);
						// The renamed note's tags are its own still; the notes sharing them now name it by its new path.
						touchedBy({ backlinks: [], tagged: [msg.to, ...links.tagged(msg.to).map((t) => t.path)] });
					}
					break;
				}

				// To the machine's trash where there is a shell to ask, and to the
				// vault's own where there is not — see trash.ts. Its log steps
				// aside either way, and comes back with the note if the note does.
				case "delete_note": {
					if (typeof msg.path !== "string") return;
					known.delete(msg.path);
					const gone = await deleteNote(CWD, msg.path, systemTrash);
					if (!gone.ok) {
						if (gone.reason === "missing") reply({ type: "note_gone", path: msg.path });
						return;
					}
					trashLog(CWD, msg.path);
					notes.remove(msg.path);
					broadcast(gone.to === "vault" ? { type: "note_deleted", path: msg.path, to: "vault", trashed: gone.trashed } : { type: "note_deleted", path: msg.path, to: "system" });
					broadcast(files());
					touchedBy(links.remove(msg.path));
					offered(propertyNames.remove(msg.path));
					break;
				}

				/**
				 * Who wrote which words. Asked for rather than always sent, and
				 * answered about the note as it is on disk — whoever asks writes
				 * down what they have typed first, the way anything that needs the
				 * disk current does.
				 *
				 * Only what somebody else was seen to write is worth saying: a note
				 * is mostly its writer's, and one marked all over says nothing.
				 */
				case "who_wrote": {
					if (typeof msg.path !== "string") return;
					const found = readNote(CWD, msg.path);
					if (!found) {
						reply({ type: "note_gone", path: msg.path });
						return;
					}
					const { replayed } = settleDisk(msg.path, found.text, found.modified, Date.now());
					const spans = replayed.spans
						// Nor what was there before the app: nobody was seen to write it.
						.filter((span) => span.author !== "me" && span.author !== "before")
						.map((span) => ({ from: span.from, to: span.to, author: span.author, at: span.at, ...(span.sessionId ? { session: span.sessionId } : {}) }));
					reply({ type: "authors", path: msg.path, spans });
					break;
				}

				/**
				 * How one run of a note came to be there.
				 *
				 * The log says who and when, and what stood there before while the
				 * run is still the whole of what its change wrote. For pi's own
				 * writing there is more, in pi's record of the conversation: the
				 * model it was on and the message the turn began with. That record
				 * is not ours and a person may have deleted it, so what cannot be
				 * found is simply left out.
				 */
				case "why_wrote": {
					if (typeof msg.path !== "string" || typeof msg.pos !== "number") return;
					const found = readNote(CWD, msg.path);
					if (!found) {
						reply({ type: "note_gone", path: msg.path });
						return;
					}
					const { replayed } = settleDisk(msg.path, found.text, found.modified, Date.now());
					const span = replayed.spans.find((s) => s.from <= msg.pos && msg.pos < s.to);
					if (!span) return;
					reply({
						type: "why",
						path: msg.path,
						from: span.from,
						to: span.to,
						author: span.author,
						at: span.at,
						text: found.text.slice(span.from, span.to),
						// Present even when it is empty, which is not the same as absent:
						// empty says the run replaced nothing, and absent says the run is
						// no longer the whole of what its change wrote, so what it
						// replaced is not known any more. A tab that cannot tell those
						// apart cannot offer to put anything back.
						...("removed" in span ? { removed: span.removed } : {}),
						...(span.sessionId ? { session: span.sessionId } : {}),
						...(span.entryId ? { entry: span.entryId } : {}),
						...(await turnOf(span.sessionId, span.entryId)),
					});
					break;
				}

				case "restore_note": {
					if (typeof msg.trashed !== "string" || typeof msg.path !== "string") return;
					const back = restoreNote(CWD, msg.trashed, msg.path);
					if (!back.ok) {
						reply({ type: "error", message: `cannot restore ${msg.path}: ${back.reason}` });
						return;
					}
					// The log comes back the way it does for a note put back in the
					// Finder: the note is read, and the trash is asked whether the
					// past waiting there replays to exactly this text.
					reply({ type: "note_created", path: msg.path });
					wrote(msg.path, null, []);
					break;
				}

				// Accepting pi's words: a change to the history, not to the note.
				case "accept_note": {
					if (typeof msg.path !== "string" || typeof msg.from !== "number" || typeof msg.to !== "number") return;
					if (!readNote(CWD, msg.path)) return;
					if (!decide(CWD, msg.path, msg.from, msg.to, Date.now(), msg.kept !== false)) {
						// Those places name nothing to decide about, so this tab and the
						// record do not agree about the note — it is a keystroke ahead,
						// or something wrote while the button was being pressed. Nothing
						// is recorded, and the note goes back as it stands, which is the
						// answer to a tab that has it wrong. Said out loud too: it should
						// not happen, since a decision goes down after the typing it was
						// made over, and a log is where a should-not is worth reading.
						console.warn(`[decide] ${msg.path} ${msg.from}–${msg.to} decides nothing; the tab is out of step`);
						const again = note(msg.path);
						if (again) reply(again);
						return;
					}
					// Nothing in the text moved: the spans are the whole of the news.
					const found = readNote(CWD, msg.path)!;
					wrote(msg.path, found.modified, []);
					break;
				}

				/**
				 * Put back what pi wrote in one run, across every note it wrote to.
				 *
				 * The notes are found by their logs: one that names the session is
				 * read, and one that says pi wrote in it during the run is a note
				 * of this run's. Each such note goes back to the text it would have
				 * with pi's undecided changes put back — the same "before" the diff
				 * in the note is drawn against — as one save of the person's, which
				 * is what pressing Undo on every chunk would have come to. A note
				 * whose chunks were all kept has nothing to put back and is left as
				 * it is: a kept chunk is the person's decision, and this is not a
				 * way around it. Nor is what the person typed since touched, since
				 * "before" holds it (see unreviewed in history.ts).
				 *
				 * Every log on disk is looked at — the folder walked, not the list in
				 * memory, since a note written a moment ago may not have reached the
				 * list yet and a button is pressed rarely — so it works on a run from
				 * before the app was last opened; a name looked for in the raw text
				 * first keeps the reading to the logs that could match.
				 */
				case "undo_run": {
					if (typeof msg.session !== "string" || typeof msg.from !== "number" || typeof msg.to !== "number") return;
					const at = Date.now();
					const put: string[] = [];
					for (const { path } of listNotes(CWD)) {
						if (!logNames(CWD, path, msg.session)) continue;
						if (!wroteIn(readHistory(CWD, path), msg.session, msg.from, msg.to)) continue;
						const found = readNote(CWD, path);
						if (!found) continue;
						const { holed } = settleDisk(path, found.text, found.modified, at);
						const { before, holes } = undecided(holed);
						if (holes.length === 0 || before === found.text) continue;
						// Over the version just read: a note that moves between the
						// read and the write — a save landing this instant — is left
						// alone rather than written over, and reported as not put back.
						const written = writeNote(CWD, path, before, found.modified);
						if (!written.ok) continue;
						const changes = record(CWD, path, found.text, before, { author: "me", at });
						wrote(path, found.modified, changes);
						put.push(path);
					}
					reply({ type: "run_undone", notes: put });
					break;
				}

				// Every note read from disk on each ask — see search.ts — and read
				// lazily, so a query that fills its results early stops reading.
				// To this tab only: it is an answer to what it typed.
				case "search_notes": {
					if (typeof msg.query !== "string" || typeof msg.id !== "number") return;
					// The folder itself, not the list in memory: a search is for every
					// note on disk, and one written a moment ago by something else has
					// not reached the list yet. The walk is the small half of this
					// anyway — every note's text is read from disk below it.
					const texts = function* () {
						for (const { path } of listNotes(CWD)) {
							const found = readNote(CWD, path);
							if (found) yield found;
						}
					};
					reply({ type: "search_results", id: msg.id, query: msg.query, hits: search(texts(), msg.query) });
					break;
				}

				// A message this server does not know — a newer client on an older
				// server, which a desktop app restarted only half of will produce.
				// Said, rather than dropped: a button that does nothing is the
				// worst way to find out.
				default:
					reply({ type: "error", message: `this server does not understand "${(msg as { type: string }).type}" — restart the app` });
			}
		} catch (err) {
			broadcast({ type: "error", message: err instanceof Error ? err.message : String(err) });
		}
	});

	// Last, and only after the handler above is registered: reading the session
	// list touches the disk, and anything the client sent while that await was
	// outstanding would arrive at a socket with no 'message' listener and be
	// dropped without a trace.
	reply(await sessions());
});

/**
 * The way to the machine's trash, or null where this run has no shell to ask.
 * Made once: it listens for the answers on the channel, and one listener is
 * enough for all of them.
 */
const systemTrash = shellTrash();

// Writes that do not pass through here — see watcher.ts.
const stopWatching = watchNotes(CWD, noticed);

server.listen(PORT, HOST, () => {
	console.log(`open http://localhost:${PORT}  (ctrl+c to stop)`);
	if (HOST !== "127.0.0.1") console.log(`listening on ${HOST} — anyone who can reach it controls this machine`);
	console.log(`model: ${currentModel()?.id ?? "none"}  thinking: ${session().thinkingLevel}`);
	console.log(`session: ${session().sessionFile ?? "(not persisted)"}`);
	console.log(`log: ${logFile}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	stopWatching();
	prompts.cancelAll();
	logins.cancel();
	await runtime.dispose();
	// server.close() waits for open connections, and an upgraded WebSocket is
	// one of them. ws does not close them for us when the http server was
	// passed in, so a browser tab left open would hang the exit.
	for (const client of clients) client.terminate();
	server.close(() => process.exit(0));
}

// Being asked to stop comes in two words, and only one of them is Ctrl+C. The
// desktop shell asks the other way — child.kill() sends SIGTERM — and with no
// listener for it the default action is to go at once, so everything above
// this line was the path that only a terminal ever took. ⌘Q never retired an
// extension or disposed a session.
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/**
 * Whatever was not caught nearer to where it happened.
 *
 * A message from a tab is handled inside a try/catch that answers the tab.
 * Everything else here is not: the watcher's callback, pi's event
 * subscription, an extension, a timer. An error in one of those used to take
 * the process with it, and the desktop shell reports a server that stopped by
 * quitting — mid-answer, with the session's own last words gone.
 *
 * So it is said instead, in both directions: to the terminal with its stack,
 * and to the tabs, which are otherwise left watching a spinner that will not
 * move. And the server stays up, because nothing it holds is the only copy of
 * anything — the notes are files, the log is a file, the session is pi's own
 * file. Staying up with one thing broken is worth more here than a clean exit
 * that takes the other three columns with it.
 */
function unhandled(what: string, err: unknown): void {
	console.error(`[${what}]`, err instanceof Error ? (err.stack ?? err.message) : err);
	if (shuttingDown) return;
	// The report must not become the next uncaught error.
	try {
		broadcast({ type: "error", message: `${what}: ${err instanceof Error ? err.message : String(err)}` });
	} catch {
		// A socket that cannot be written to is not news at this point.
	}
}
process.on("uncaughtException", (err) => unhandled("uncaught error", err));
process.on("unhandledRejection", (reason) => unhandled("unhandled rejection", reason));
