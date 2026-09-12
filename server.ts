/**
 * A web UI over one pi coding-agent session.
 *
 * Serves the built client from dist/, owns an AgentSessionRuntime, and forwards
 * every session event to connected browsers as raw JSON. The browser holds no
 * state of its own: config, usage, sessions, and snapshot messages describe the
 * server's state and are rebroadcast whenever it changes.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createEventBus,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type AgentSessionEvent,
	type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { itemsFromMessages } from "./conversation.js";
import { modeToolNames } from "./toolModes.ts";
import { readSettings, writeSettings } from "./settings.ts";
import { createPromptBridge } from "./prompts.ts";
import { branchPoints } from "./branches.ts";
import { listNotes, newNoteName, readNote, renameNote, restoreNote, trashNote, writeNote } from "./vault.ts";
import { accept, type Change, historyPath, mapThrough, moveHistory, moveLog, reconcile, record, replay, readHistory, trashHistoryPath } from "./history.ts";
import { answering, asked, under, type Ask, type AskOutcome } from "./ask.ts";
import { type Claim, recorder } from "./recorder.ts";
import { watchNotes } from "./watcher.ts";
import { guard, VAULT_PROMPT } from "./guard.ts";
import { renameTarget } from "./naming.ts";
import { LinkStore } from "./linkIndex.ts";
import { backlinksOf, retarget } from "./links.ts";
import { search } from "./search.ts";
import type {
	BranchesMsg,
	ClientMsg,
	ConfigMsg,
	ContextSourcesMsg,
	FilesMsg,
	NoteChangedMsg,
	NoteMsg,
	PiEventMsg,
	ServerMsg,
	SessionsMsg,
	SnapshotMsg,
	UsageMsg,
} from "./protocol.ts";

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
 * Models with usable credentials, as pi sees them right now.
 *
 * Read each time rather than once at startup, the way pi's own rpc and
 * interactive modes do. pi's availability pass can be invalidated by a
 * credential write that lands while it runs — a provider's OAuth token being
 * renewed as the process starts — and what that pass returns is then only the
 * provider that wrote. pi recovers on its next pass; a copy taken at startup
 * never would, and it showed one provider's models until a restart.
 */
const availableModels = () => modelRuntime.getAvailableSnapshot();

/**
 * The runtime, not a bare session: /new and /resume replace the AgentSession
 * object, and only the runtime can do that. Everything below reads
 * runtime.session rather than capturing it.
 */
/**
 * Shared with the extensions. The dashboard extension listens on it for
 * answerers to register (see prompts.ts); passing ours into the resource loader
 * is what makes its `pi.events` the same bus this process can emit on.
 */
const eventBus = createEventBus();

/**
 * The dashboard extension keeps its state on `process` so that a second load
 * in the same process — which it assumes is a subagent — can find the first
 * and stand down. pi replacing the session (New, Resume) reloads every
 * extension in this process, so the reloaded bridge stood down too: no tools
 * registered (13 became 8), no ui patch, no hook. Worse, the state it carried
 * over held the previous session's context, and touching that threw inside its
 * session_start, which skipped everything after.
 *
 * So before a session is built the previous bridge is retired the way its own
 * initialiser retires one — cleanup, connections, timers — and its state
 * removed, which makes the reload a first load. This is its internal state,
 * not an interface: if the key moves this is a no-op and bind() warns that
 * ask_user's hook did not answer.
 */
function retireDashboardBridge(): void {
	const key = "__pi_dashboard_bridge__";
	const prev = (process as unknown as Record<string, DashboardBridgeState | undefined>)[key];
	if (!prev) return;
	try {
		prev.cleanup?.();
	} catch {
		// Its problem to report; ours is only to get out of its way.
	}
	for (const connection of prev.connections ?? []) {
		try {
			connection.disconnect();
		} catch {
			// As above.
		}
	}
	for (const timer of prev.timers ?? []) clearInterval(timer);
	delete (process as unknown as Record<string, unknown>)[key];
}

interface DashboardBridgeState {
	cleanup?: () => void;
	connections?: { disconnect(): void }[];
	timers?: ReturnType<typeof setInterval>[];
}

/**
 * The note open in the editor of the tab that last sent a prompt, given to
 * pi for the turn as a line of the system prompt — see guard.ts. One value,
 * not one per tab: pi has one conversation.
 */
let openNote: string | null = null;

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
	retireDashboardBridge();
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
			eventBus,
			// pi is told this is a folder of notes — see guard.ts.
			appendSystemPrompt: [VAULT_PROMPT],
			extensionFactories: [
				// The guard first: a blocked call never reaches the recorder.
				{ name: "guard", factory: guard(CWD, () => openNote) },
				// pi's writes to notes go into their history as they happen, and the
				// tabs looking at a note hear about it.
				{ name: "recorder", factory: notes.factory },
				// A turn that answers about a chosen part of a note says it rather
				// than writing it; the answer is put in here — see ask.ts.
				{ name: "answering", factory: answering(() => asking !== null, answered) },
			],
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

/** Derived from the session so it stays in sync; pi does not re-export ThinkingLevel. */
type ThinkingLevel = ReturnType<typeof session>["thinkingLevel"];

/** Everything the settings UI needs. Re-sent whenever any of it changes. */
function config(): ConfigMsg {
	const s = session();
	const model = s.model;
	return {
		type: "config",
		model: model ? modelKey(model) : null,
		models: availableModels().map(modelKey),
		thinkingLevel: s.thinkingLevel,
		thinkingLevels: s.supportsThinking() ? s.getAvailableThinkingLevels() : [],
		tools: s.getAllTools().map((tool) => ({ name: tool.name, description: tool.description })),
		activeTools: s.getActiveToolNames(),
		isStreaming: s.isStreaming,
		queued: {
			steering: [...s.getSteeringMessages()],
			followUp: [...s.getFollowUpMessages()],
		},
		sessionId: s.sessionId,
		sessionName: s.sessionName ?? null,
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
	const provider = s.model?.provider;
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
 * Where the conversation on screen has alternatives. See branches.ts, which
 * holds the tree reading so it can be tested against a session built on purpose.
 */
function branches(): BranchesMsg {
	return { type: "branches", nodes: branchPoints(session().sessionManager) };
}

/** The notes in the working folder. See vault.ts. */
function files(): FilesMsg {
	return { type: "files", files: listNotes(CWD) };
}

/**
 * Bring a note's log up to what is on disk, asking whose the difference is.
 *
 * Every place that settles the disk goes through here, because the answer is
 * the same question everywhere: a write that missed the app is the person's,
 * unless pi's shell was running and this is what it did — which only the
 * recorder knows. See recorder.ts.
 */
function settleDisk(path: string, text: string, mtime: number, at: number) {
	return reconcile(CWD, path, text, at, claimant?.(path, mtime) ?? { author: "outside", at });
}

/**
 * One note, with who wrote what. Opening it also brings its history up to the
 * disk: an edit made outside the app is logged as such here, before anything
 * is drawn or measured against it.
 */
function note(path: string): NoteMsg | null {
	const found = readNote(CWD, path);
	if (!found) return null;
	const { spans } = settleDisk(path, found.text, found.modified, Date.now());
	known.set(path, found.modified);
	return { type: "note", path, text: found.text, modified: found.modified, spans, backlinks: links.backlinks(path) };
}

/** Every note's links, for "who links here" — see linkIndex.ts. */
const links = new LinkStore(CWD);
links.load();

/** After a change to what links where: the notes whose backlinks may differ hear theirs again. */
function backlinksFor(paths: string[]): void {
	for (const path of paths) broadcast({ type: "backlinks", path, notes: links.backlinks(path) });
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
		backlinksFor(links.remove(path));
		broadcast(files());
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
	if (found) backlinksFor(links.update(path, found.text));
	if (found && base !== null && replay(readHistory(CWD, path)).text === found.text) {
		const { spans } = replay(readHistory(CWD, path));
		known.set(path, found.modified);
		const msg: NoteChangedMsg = { type: "note_changed", path, base, modified: found.modified, changes, spans };
		broadcast(msg);
	} else {
		const msg = note(path);
		if (msg) broadcast(msg);
	}
	broadcast(files());
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
 * pi's words, put into the note under the line the words at `to` end on, as
 * pi's — marked until the person accepts them, like anything pi writes.
 *
 * The person asking for them to be put there does not make them theirs; what
 * it makes is the moment they land, which is why this is a write of pi's made
 * on a person's word, and goes out by the path every write takes: the file,
 * then the log, then the tabs.
 */
function putUnder(path: string, to: number, words: string, sessionId: string, entryId?: string): boolean {
	const found = readNote(CWD, path);
	if (!found) return false;
	const text = under(found.text, to, words);
	const written = writeNote(CWD, path, text, found.modified);
	if (!written.ok) return false;
	const changes = record(CWD, path, found.text, text, { author: "pi", at: Date.now(), sessionId, entryId });
	wrote(path, found.modified, changes);
	return true;
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
	// And it may have written a note, or renamed one.
	if (event.type === "agent_settled") broadcast(files());
}

let unsubscribe: (() => void) | undefined;

/** Rebind after the runtime swaps in a different AgentSession. */
async function bind(): Promise<void> {
	unsubscribe?.();
	await session().bindExtensions({});
	// The extension's hook is registered inside bindExtensions (its session_start
	// runs there), so this is the earliest point it can hear us — and it has to
	// be repeated per bind, because a replaced session rebuilds the bus.
	const hooked = prompts.register(eventBus);
	if (!hooked && session().getAllTools().some((tool) => tool.name === "ask_user")) {
		console.warn(
			"ask_user is loaded but its prompt:register-adapter hook did not answer; questions will time out instead of showing in the UI",
		);
	}
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

if (!session().model) {
	// The desktop shell puts whatever this prints in front of the user, and this
	// is the one message someone starting out is likely to need.
	console.error("No model has usable credentials. Run `pi` in a terminal, sign in with /login, then start this again.");
	process.exit(1);
}

// As pi's rpc mode does after startup: bring the model catalogues up to date in
// the background, and tell the clients if that changed what is on offer.
{
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	void modelRuntime
		.refresh({ signal: controller.signal })
		.then(() => broadcast(config()))
		.catch(() => {})
		.finally(() => clearTimeout(timeout));
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
				return json(200, writeSettings(JSON.parse(await text(req))));
			} catch {
				return json(400, { error: "invalid JSON" });
			}
		}
		if (req.method !== "GET") return json(405, { error: "read only" });
		if (pathname === "/api/settings") return json(200, readSettings());
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
	reply(usage());
	reply(contextSources());
	reply(snapshot());
	reply(branches());
	reply(files());
	// A tab opened while a question is waiting should see it too.
	for (const prompt of prompts.open()) reply({ type: "prompt_request", prompt });

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
					openNote = typeof msg.note === "string" ? msg.note : null;
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

				case "set_thinking": {
					// setThinkingLevel clamps rather than rejecting, so an unknown
					// value would silently become "off". Validate first.
					const levels = config().thinkingLevels;
					if (typeof msg.level !== "string" || !levels.includes(msg.level as ThinkingLevel)) {
						reply({ type: "error", message: `unsupported thinking level: ${msg.level}` });
						return;
					}
					// As with the model: persist makes the choice outlive this session.
					session().setThinkingLevel(msg.level as ThinkingLevel, { persist: true });
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
					const existing = listNotes(CWD).map((f) => f.path);
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
					const written = writeNote(CWD, path, "", null);
					if (!written.ok) {
						reply({ type: "note_rename_failed", path: "", to: path, reason: "invalid" });
						return;
					}
					record(CWD, path, "", "", { author: "me", at: Date.now() });
					reply({ type: "note_created", path });
					wrote(path, null, []);
					break;
				}

				// A note's path is its name. The file and its history move together,
				// and the version the tabs hold moves with them, so the watcher's
				// report of the move is not taken for someone writing.
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
					broadcast(files());
					if (msg.path !== msg.to) {
						// The notes that linked to the old name now link to the new one,
						// as Obsidian does: each is rewritten as a write of the person's,
						// since the person asked for the rename, and goes out like one.
						const before = links.paths();
						const linking = backlinksOf(Object.fromEntries(before.map((p) => [p, links.linksOf(p)])), msg.path, before);
						links.rename(msg.path, msg.to);
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
					}
					break;
				}

				// To the trash, with its history, where restore_note can find it.
				case "delete_note": {
					if (typeof msg.path !== "string") return;
					known.delete(msg.path);
					const gone = trashNote(CWD, msg.path);
					if (!gone.ok) {
						if (gone.reason === "missing") reply({ type: "note_gone", path: msg.path });
						return;
					}
					moveLog(historyPath(CWD, msg.path), trashHistoryPath(CWD, gone.trashed));
					broadcast({ type: "note_deleted", path: msg.path, trashed: gone.trashed });
					broadcast(files());
					backlinksFor(links.remove(msg.path));
					break;
				}

				case "restore_note": {
					if (typeof msg.trashed !== "string" || typeof msg.path !== "string") return;
					const back = restoreNote(CWD, msg.trashed, msg.path);
					if (!back.ok) {
						reply({ type: "error", message: `cannot restore ${msg.path}: ${back.reason}` });
						return;
					}
					moveLog(trashHistoryPath(CWD, msg.trashed), historyPath(CWD, msg.path));
					reply({ type: "note_created", path: msg.path });
					wrote(msg.path, null, []);
					break;
				}

				// Accepting pi's words: a change to the history, not to the note.
				case "accept_note": {
					if (typeof msg.path !== "string" || typeof msg.from !== "number" || typeof msg.to !== "number") return;
					if (!readNote(CWD, msg.path)) return;
					accept(CWD, msg.path, msg.from, msg.to, Date.now());
					// Nothing in the text moved: the spans are the whole of the news.
					const found = readNote(CWD, msg.path)!;
					wrote(msg.path, found.modified, []);
					break;
				}

				// Every note read from disk on each ask — see search.ts — and read
				// lazily, so a query that fills its results early stops reading.
				// To this tab only: it is an answer to what it typed.
				case "search_notes": {
					if (typeof msg.query !== "string" || typeof msg.id !== "number") return;
					const notes = function* () {
						for (const { path } of listNotes(CWD)) {
							const found = readNote(CWD, path);
							if (found) yield found;
						}
					};
					reply({ type: "search_results", id: msg.id, query: msg.query, hits: search(notes(), msg.query) });
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

// Writes that do not pass through here — see watcher.ts.
const stopWatching = watchNotes(CWD, noticed);

server.listen(PORT, HOST, () => {
	console.log(`open http://localhost:${PORT}  (ctrl+c to stop)`);
	if (HOST !== "127.0.0.1") console.log(`listening on ${HOST} — anyone who can reach it controls this machine`);
	console.log(`model: ${session().model?.id ?? "none"}  thinking: ${session().thinkingLevel}`);
	console.log(`session: ${session().sessionFile ?? "(not persisted)"}`);
});

let shuttingDown = false;
process.on("SIGINT", async () => {
	if (shuttingDown) return;
	shuttingDown = true;
	stopWatching();
	prompts.cancelAll();
	await runtime.dispose();
	// server.close() waits for open connections, and an upgraded WebSocket is
	// one of them. ws does not close them for us when the http server was
	// passed in, so a browser tab left open would hang the exit.
	for (const client of clients) client.terminate();
	server.close(() => process.exit(0));
});
