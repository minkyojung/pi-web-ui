/**
 * One folder being worked in, and everything that is its own.
 *
 * The notes and their indexes, the pi session and what it is told, the tabs
 * looking at it and everything they hear: all of it made by createWorkspace
 * for one folder, and none of it shared with another. The process — its
 * port, its log, the model runtime — is server.ts's; a workspace is what it
 * serves.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { bytes } from "./request.ts";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type WebSocket } from "ws";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	hasTrustRequiringProjectResources,
	ModelRuntime,
	ProjectTrustStore,
	SessionManager,
	type AgentSessionEvent,
	type CreateAgentSessionRuntimeFactory,
	readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { itemsFromMessages, textOf } from "./conversation.js";
import { LOG_PATH } from "./log.ts";
import { modeToolNames, withWeb } from "./toolModes.ts";
import {
	clampLevel,
	isUnknownModel,
	loadoutOf,
	lostProviders,
	modelsNotice as modelsNotice_,
	providerInfo,
	supportedLevels,
} from "./models.ts";
import { readSettings, updateSettings, type Settings } from "./settings.ts";
import { askForName } from "./sessionName.ts";
import { askUser } from "./askUser.ts";
import specCommand, { takenSpecs, taskMarkEntry } from "./spec.ts";
import { createPromptBridge } from "./prompts.ts";
import { extensionUI } from "./extensionUI.ts";
import { deleteSessionFile } from "./sessionDelete.ts";
import { Cancelled } from "./prompts.ts";
import { branchPoints } from "./branches.ts";
import {
	documentAt,
	listNotes,
	newNoteName,
	type Note,
	readCode,
	readNote,
	readSpec,
	renameNote,
	restoreNote,
	specAt,
	specRecordAt,
	withCreated,
	writeNote,
	writeSpec,
	type WriteResult,
} from "./vault.ts";
import { attachmentAt } from "./pictures.ts";
import { FileIndex } from "./fileIndex.ts";
import { type Repo, repoFiles } from "./repoFiles.ts";
import { deleteNote, shellTrash } from "./trash.ts";
import { createLoginBridge } from "./login.ts";
import { noteTools } from "./noteEdit.ts";
import { claimAppDir } from "./appDir.ts";
import { wall } from "./wall.ts";
import { documents } from "./documents.ts";
import { MAX_BYTES, saveAttachment, type Saved } from "./attach.ts";
import { documentType, SPEC_DOCS, SPECS_DIR } from "./documentKinds.ts";
import { specState } from "./specApproval.ts";
import { inheritedSpecs } from "./specOrigin.ts";
import { parseTasks, progressOf, type Progress } from "./specTasks.ts";
import { type TaskResult, taskResults } from "./specResults.ts";
import {
	baseLine,
	baseOf,
	githubLine,
	standingIn,
} from "./standing.ts";
import { readCommit } from "./commitRead.ts";
import {
	decide,
	type Change,
	historyOf,
	type Holed,
	logNames,
	mapThrough,
	moveHistory,
	type Origin,
	reconcile,
	record,
	readHistory,
	trashLog,
	undecided,
	wroteIn,
} from "./history.ts";
import {
	answering,
	asked,
	under,
	type Ask,
	type AskOutcome,
} from "./ask.ts";
import { watchNotes } from "./watcher.ts";
import { guard, WORKSPACE_PROMPT } from "./guard.ts";
import { renameTarget } from "./naming.ts";
import { LinkStore, type Touched } from "./linkIndex.ts";
import { PropertyStore } from "./propertyIndex.ts";
import { PropertyRegistry } from "./propertyRegistry.ts";
import { isPropertyType } from "./propertyTypes.ts";
import { backlinksOf, retarget } from "./links.ts";
import { search } from "./search.ts";
import { sectionFor } from "./changelog.mjs";
import type {
	Authored,
	BranchesMsg,
	ClientMsg,
	CodeGoneMsg,
	CodeMsg,
	CommandsMsg,
	ConfigMsg,
	ContextSourcesMsg,
	ErrorMsg,
	FilesMsg,
	ModelInfo,
	NoteChangedMsg,
	NoteMsg,
	PiSettings,
	PiEventMsg,
	ProvidersMsg,
	RepoMsg,
	ServerMsg,
	SessionsMsg,
	SettingsMsg,
	SnapshotMsg,
	SpecMsg,
	SpecsMsg,
	StandingMsg,
	UsageMsg,
} from "./protocol.ts";

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


/** This run of the server, and how many times it has written the settings. See SettingsMsg's revision. */
const SETTINGS_BOOT = randomUUID();
let settingsWrites = 0;
const settingsMsg = (settings: Settings, n: number): SettingsMsg => ({ type: "settings", settings, revision: { boot: SETTINGS_BOOT, n } });
/** The settings as they stand, at the revision they stand at — what a tab is told as it connects. */
export const settingsNow = (): SettingsMsg => settingsMsg(readSettings(), settingsWrites);
/** The settings with `patch` written into them, at the next revision — every folder's tabs are then told (settingsChanged). Throws as updateSettings does. */
export const writeSettings = (patch: Record<string, unknown>): SettingsMsg => settingsMsg(updateSettings(patch), ++settingsWrites);

/** The trash the folder's deleted notes go to: the machine's, through the shell, where there is one — see trash.ts. */
const systemTrash = shellTrash();

/**
 * One folder being worked in: its notes and their indexes, its pi session,
 * the tabs looking at it and everything they are told. The process has been
 * one of these since the start, as module-level state; it is a function of
 * the folder now, and nothing else changed — so that a process can hold more
 * than one, which is the next step and not this one. What is the process's
 * rather than the folder's — the model runtime, the port, the built page —
 * stays above.
 */
export async function createWorkspace(cwd: string) {
	const CWD = cwd;

	/**
	 * The runtime, not a bare session: /new and /resume replace the AgentSession
	 * object, and only the runtime can do that. Everything below reads
	 * runtime.session rather than capturing it.
	 */
	/**
	 * The note open in the editor of the tab that last sent a prompt, and the
	 * words chosen in it, given to pi beside the prompt as a hidden message — see
	 * guard.ts. One value, not one per tab: pi has one conversation.
	 */
	let openNote: { path: string; chosen: string | null; page?: string } | null = null;

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
	 * The one extension Octave loads from a file rather than writing itself:
	 * pi-web-access, which is where web_search, fetch_content, source_check and
	 * get_search_content come from. A note app whose agent cannot read a page is
	 * missing half of what a note is written from.
	 *
	 * A dependency of ours, resolved out of our own node_modules, rather than the
	 * copy in the person's pi: that is the whole point of noExtensions below, and
	 * a tool that is there on one machine and not the next is still one nobody can
	 * be told about. The package names its entry in package.json (`pi.extensions`)
	 * and ships it as TypeScript, so it is handed to pi as a path and pi's loader
	 * transpiles it — importing it here would only put source esbuild cannot
	 * bundle into the server.
	 */
	const WEB_ACCESS = dirname(createRequire(import.meta.url).resolve("pi-web-access/package.json"));

	/**
	 * Whether pi may read the vault's own `.pi/` — its settings.json, skills,
	 * prompts, SYSTEM.md — the way it reads a project's. pi's terminal asks the
	 * person the first time and remembers the answer in its trust file; nothing
	 * here asks yet, so the answer is what that file says, and no unless it says
	 * otherwise. A vault with none of those has nothing to trust and is read as
	 * before. Left to the SDK, the answer is yes without asking.
	 */
	function projectTrusted(cwd: string): boolean {
		if (!hasTrustRequiringProjectResources(cwd)) return true;
		return new ProjectTrustStore(getAgentDir()).get(cwd) ?? false;
	}

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const trusted = projectTrusted(cwd);
		// Once, as the session opens: the base does not move under a session, and
		// a line in the system prompt is cached with it where a message each turn
		// would not be.
		const base = await baseOf(cwd);
		const said = [WORKSPACE_PROMPT, baseLine(base), githubLine(base, process.env.GH_TOKEN)].filter((line): line is string => line !== null);
		const services = await createAgentSessionServices({
			cwd,
			modelRuntime,
			// Inline rather than a file under .pi/extensions/: that path needs the
			// project trusted, and the desktop shell's cwd is wherever it was opened.
			resourceLoaderOptions: {
				// pi's own system prompt stands — a coding agent's, which is what
				// this is — and after it, where the agent is and the few rules that
				// are this app's: see guard.ts.
				appendSystemPrompt: said,
				extensionFactories: [
					// The guard first: a blocked call never reaches anything after it.
					{ name: "guard", factory: guard(CWD, () => openNote) },
					// Then the wall: what the guard let through, the shell runs behind
					// it, where a note cannot be written. See wall.ts.
					{ name: "wall", factory: wall(CWD) },
					// A PDF read with pi's read comes back as its text, page by page —
					// see documents.ts.
					{ name: "documents", factory: documents(CWD) },
					// The one pair a note is written by — what the guard above sends
					// edit and write to when they reach for one. See noteEdit.ts.
					{ name: "notes", factory: noteTools(CWD, piWrote) },
					// A turn that answers about a chosen part of a note says it rather
					// than writing it; the answer is put in here — see ask.ts.
					{ name: "answering", factory: answering(() => asking !== null, answered) },
					// pi asking the person, answered in the browser — see askUser.ts.
					// The bridge is reached when a question is asked, not now: it is
					// made further down, after this first session is.
					{ name: "ask", factory: askUser(() => prompts.ask) },
					// `/spec` and a line: the requirements of a spec, written for the
					// person to read — see spec.ts, which runs in pi's terminal too.
					{ name: "spec", factory: specCommand },
				],
				// The extensions installed for the person's own pi — ~/.pi/agent/
				// extensions, the packages in its settings — load here as they load
				// there, unless the Settings switch says not to: one of them has cost
				// a second on every new session, and that is the person's to weigh.
				// What Octave brings (above, and pi-web-access below) loads either way.
				noExtensions: !readSettings().loadExtensions,
				additionalExtensionPaths: [WEB_ACCESS],
				// A tool of the person's extensions that has the name of one of
				// Octave's own — ask_user, the note tools — would be the one pi kept,
				// since files load before inline factories and the first owner of a
				// name keeps it (detectExtensionConflicts). Octave's wins here, and the
				// extension is told in pi's own words, in the conversation.
				extensionsOverride: (loaded) => {
					// pi-web-access is Octave's own dependency, loaded above from its
					// node_modules; the person's pi may list the same package, and pi
					// would then load it twice — its commands split into curator:1 and
					// curator:2, its tools reported as clashing with themselves. The
					// copy Octave brings is the one kept; the person's is not loaded.
					const theirs = (ext: { path: string; resolvedPath: string }) =>
						!ext.path.startsWith("<inline:") && !ext.resolvedPath.startsWith(WEB_ACCESS) && /[\\/]node_modules[\\/]pi-web-access[\\/]/.test(ext.resolvedPath);
					const dropped = new Set(loaded.extensions.filter(theirs).map((ext) => ext.path));
					loaded.extensions = loaded.extensions.filter((ext) => !dropped.has(ext.path));
					// pi had already found that copy clashing with the one kept; a
					// clash with what is not loaded is nothing to say.
					loaded.errors = loaded.errors.filter((e) => !dropped.has(e.path));
					const ours = new Map<string, string>();
					for (const ext of loaded.extensions) {
						if (ext.path.startsWith("<inline:")) for (const name of ext.tools.keys()) ours.set(name, ext.path);
					}
					for (const ext of loaded.extensions) {
						if (ext.path.startsWith("<inline:")) continue;
						for (const name of [...ext.tools.keys()]) {
							const owner = ours.get(name);
							if (!owner) continue;
							ext.tools.delete(name);
							loaded.errors.push({ path: ext.path, error: `Tool "${name}" conflicts with ${owner}; Octave's is kept` });
						}
					}
					return loaded;
				},
			},
			resourceLoaderReloadOptions: { resolveProjectTrust: async () => trusted },
		});
		return {
			// No `model`: pi picks it the way the CLI does — the one the session was
			// on, else the persisted default (which set_model writes), else the first
			// with credentials. Choosing here would bypass the first two.
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				// pi registers powershell on every platform; off Windows there is no
				// PowerShell to run it, so it would only be a tool that always fails.
				excludeTools: process.platform === "win32" ? undefined : ["powershell"],
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
		saidRun = JSON.stringify(runOf());
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
			isCompacting: s.isCompacting,
			pi: piSettings(),
			queued: {
				steering: [...s.getSteeringMessages()],
				followUp: [...s.getFollowUpMessages()],
			},
			sessionId: s.sessionId,
			sessionName: s.sessionName ?? null,
			run: runOf(),
			folder: CWD,
			log: LOG_PATH,
		};
	}

	/**
	 * The mark whose turn has ended, by its entry's id. The mark stays in the
	 * session after the run — the box and the commit are made at its end — and
	 * the turns after it are conversation, so "this session is running a task"
	 * is the mark being there and its turn not being over.
	 */
	let runOver: string | null = null;

	/** The task this session is running now, or null. */
	function runOf(): ConfigMsg["run"] {
		const s = session();
		if (!s.isStreaming) return null;
		const found = taskMarkEntry(s.sessionManager.buildContextEntries());
		if (!found || found.id === runOver) return null;
		const { spec, task, title, then } = found.mark;
		return { spec, task, title, then };
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
			extensions: loader
				.getExtensions()
				.extensions.filter((e) => !e.path.startsWith("<inline:") && !e.resolvedPath.startsWith(WEB_ACCESS)).length,
			memoryFiles: { count: files.length, chars: files.reduce((n, f) => n + f.content.length, 0) },
			// The vault has a .pi/ pi would read as a project's, and was not let to.
			untrusted: hasTrustRequiringProjectResources(CWD) && !s.settingsManager.isProjectTrusted(),
			login: {
				oauth: provider ? modelRuntime.isUsingOAuth(provider) : false,
				subscription: provider ? modelRuntime.isUsingSubscription(provider) : false,
			},
		};
	}

	/** pi's settings as pi reads them now, for the switches in Settings. */
	function piSettings(): PiSettings {
		const m = session().settingsManager;
		return {
			compaction: m.getCompactionSettings(),
			retryEnabled: m.getRetryEnabled(),
			hideThinkingBlock: m.getHideThinkingBlock(),
			askBranchSummary: !m.getBranchSummarySkipPrompt(),
			projectTrust: !hasTrustRequiringProjectResources(CWD) ? "nothing" : m.isProjectTrusted() ? "trusted" : "untrusted",
		};
	}

	/**
	 * Trusting this folder, or not: the answer goes where pi's terminal keeps its
	 * own (/trust, trust.json), then to the session that is open, which reads
	 * the folder's .pi/ again on the spot — pi's reload keeps the trust it is
	 * given and loads what that allows. The next session reads the file.
	 */
	async function setProjectTrust(trusted: boolean): Promise<void> {
		new ProjectTrustStore(getAgentDir()).set(CWD, trusted);
		session().settingsManager.setProjectTrusted(trusted);
		await session().reload();
	}

	/**
	 * The one of pi's settings shown here that pi has no setter for. Written
	 * into pi's own settings.json under pi's own key, then read back through
	 * pi's reload, so pi's copy and the file agree — as they would had pi
	 * written it.
	 */
	async function setBranchSummarySkipPrompt(skip: boolean): Promise<void> {
		const path = join(getAgentDir(), "settings.json");
		let all: Record<string, unknown> = {};
		try {
			all = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
		} catch {
			// No file, or not JSON yet: pi starts from nothing too.
		}
		const branchSummary = { ...((all.branchSummary as Record<string, unknown> | undefined) ?? {}), skipPrompt: skip };
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify({ ...all, branchSummary }, null, 2)}\n`);
		await session().settingsManager.reload();
	}

	/**
	 * What "/" can name, the three kinds and in the order pi's own get_commands
	 * lists them. Read from the session, since an extension's commands are
	 * registered when it is bound to one.
	 */
	function commands(): CommandsMsg {
		const s = session();
		return {
			type: "commands",
			commands: [
				...s.extensionRunner.getRegisteredCommands().map((c) => ({
					name: c.invocationName,
					description: c.description,
					source: "extension" as const,
				})),
				...s.promptTemplates.map((t) => ({ name: t.name, description: t.description, source: "prompt" as const })),
				...runtime.services.resourceLoader.getSkills().skills.map((k) => ({
					name: `skill:${k.name}`,
					description: k.description,
					source: "skill" as const,
				})),
			],
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
		return { type: "files", files: notes.all(), documents: notes.documents(), truncated: notes.truncated };
	}

	/**
	 * A file of the repository as a tab reads it, or why there is nothing to
	 * read — see readCode. Nothing of the note's message is here: a file read in
	 * a tab has no log, no links and no save to be refused.
	 */
	function code(path: string): CodeMsg | CodeGoneMsg {
		const read = readCode(CWD, path);
		return read.ok
			? { type: "code", path: read.path, text: read.text, modified: read.modified, truncated: read.truncated }
			: { type: "code_gone", path, reason: read.reason };
	}

	/** The repository's files as git last listed them, or none where the folder is in no repository. */
	function repoMsg(): RepoMsg {
		return { type: "repo", files: repo?.files ?? [], truncated: repo?.truncated ?? false };
	}

	/**
	 * Ask git again, and tell the tabs only when the answer is not the one they
	 * have — the same rule the notes' index answers by (fileIndex.ts), for the
	 * same reason: most turns write into files that are already on the list.
	 */
	async function loadRepo(): Promise<void> {
		const was = repo;
		const next = await repoFiles(CWD);
		repo = next;
		const same = was?.files.length === next?.files.length && (was?.files ?? []).every((path, at) => next?.files[at] === path);
		if (!same) broadcast(repoMsg());
	}

	/**
	 * Bring a note's log up to what is on disk, asking whose the difference is.
	 *
	 * Every place that settles the disk goes through here, because the answer is
	 * the same question everywhere. Never pi's: pi writes a note by note_edit and
	 * note_write, which say so as they write, and its shell cannot write one at
	 * all (wall.ts). Outside's, if the note is one the folder did not have when
	 * the app listed it: it appeared while the app was running, so every word of
	 * it was written by someone, just now, and not through here. Else what the
	 * log makes of it — a difference from what it knew is outside's, and a note
	 * it never knew is from before (reconcile).
	 */
	/**
	 * How much of a note somebody other than the person reading it wrote, from the
	 * spans the log replays to. See Authored in protocol.ts.
	 *
	 * Only pi and outside are counted. `me` is the person's own and `before` is
	 * what was there when the app first saw the note, which nobody was seen to
	 * write — neither is somebody else's hand.
	 */
	function shareOf(spans: { from: number; to: number; author: string }[], total: number): Authored {
		let pi = 0;
		let other = 0;
		for (const span of spans) {
			if (span.author === "pi") pi += span.to - span.from;
			else if (span.author === "outside") other += span.to - span.from;
		}
		return { pi, other, total };
	}

	function settleDisk(path: string, text: string, at: number) {
		const origin: Origin | undefined = notes.has(path) ? undefined : { author: "outside", at };
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
		const { holed, replayed, lines } = settleDisk(path, found.text, Date.now());
		known.set(path, found.modified);
		return {
			type: "note",
			path,
			text: found.text,
			modified: found.modified,
			lines,
			original: toDecide(holed),
			backlinks: links.backlinks(path),
			tagged: links.tagged(path),
			authored: shareOf(replayed.spans, found.text.length),
		};
	}

	/**
	 * One spec, whole: what note() answers less everything the log and the links
	 * add, since a spec keeps neither (SpecMsg). Remembered at the version sent,
	 * as a note is, so that the watcher's report of a write the tabs already
	 * have is not taken for a new one.
	 */
	function spec(path: string): SpecMsg | null {
		const found = readSpec(CWD, path);
		if (!found) return null;
		known.set(path, found.modified);
		return { type: "note", kind: "spec", path, text: found.text, modified: found.modified };
	}

	/**
	 * Where every spec in the folder stands (SpecsMsg): read off the documents
	 * and the record beside them, never kept. The window opens what is waiting,
	 * so it is also told when each waiting document was written — of two specs
	 * waiting at once, the newer is the one the person has just been given — and
	 * which documents are there at all, which the approvals alone cannot say.
	 *
	 * Every spec in the folder, and which of them this workspace started — a
	 * workspace made from the base has the base's specs on its disk, and only
	 * git can tell those from the work here (specOrigin.ts).
	 */
	function specs(): SpecsMsg {
		const inherited = inheritedNow();
		return {
			type: "specs",
			specs: takenSpecs(CWD).map((name) => {
				const dir = join(CWD, SPECS_DIR, name);
				const { approved, waiting } = specState(CWD, name);
				return {
					name,
					own: !inherited.has(name),
					approved,
					waiting,
					waitingAt: waiting ? writtenAt(join(dir, waiting)) : null,
					written: SPEC_DOCS.filter((doc) => existsSync(join(dir, doc))),
					tasks: tasksOf(join(dir, "tasks.md"), results.get(name) ?? []),
					results: results.get(name) ?? [],
				};
			}),
		};
	}

	/**
	 * What the tasks came to, as git last said — see specResults.ts. Held rather
	 * than asked for each time specs() is: that is read on every write to a
	 * spec's folder and is synchronous, and this is a walk of the history.
	 *
	 * Asked again when the answer can have changed: as the server starts, as a
	 * tab connects, as a turn settles — a task's commit is made at the end of
	 * its turn, before the server hears of it — and a moment after a spec's
	 * file changes, which is how a run from the terminal is seen: its box is
	 * written and then its commit made, so the asking waits for the second.
	 */
	let results = new Map<string, TaskResult[]>();
	let resultsSoon: ReturnType<typeof setTimeout> | null = null;

	/**
	 * The specs this workspace did not start (specOrigin.ts). Git's answer too,
	 * and read beside the results because the two move together: what the base
	 * had when this branch left it changes on a fetch or a rebase, and not on
	 * anything the person does to the documents. Read at once the first time it
	 * is asked, so no spec is ever named as this workspace's before it is known
	 * whose it is.
	 */
	let inherited: Set<string> | null = null;
	const inheritedNow = (): Set<string> => (inherited ??= inheritedSpecs(CWD));

	async function loadResults(): Promise<void> {
		inherited = inheritedSpecs(CWD);
		results = await taskResults(CWD);
		saySpecs();
		// A task's commit moves the branch too.
		void sayStanding();
	}

	/** Where the branch stands, said to every window — see standing.ts. */
	async function sayStanding(to?: (msg: StandingMsg) => void): Promise<void> {
		const msg: StandingMsg = { type: "standing", standing: await standingIn(CWD) };
		if (to) to(msg);
		else broadcast(msg);
	}

	function loadResultsSoon(): void {
		if (resultsSoon) clearTimeout(resultsSoon);
		resultsSoon = setTimeout(() => {
			resultsSoon = null;
			void loadResults();
		}, 600);
	}

	/** How far a spec's tasks have got, or null while the file is not there. A task a run has ended in a commit for is waiting to be looked at, and is not next. */
	function tasksOf(file: string, ran: TaskResult[]): Progress | null {
		try {
			return progressOf(parseTasks(readFileSync(file, "utf8")), new Set(ran.map((result) => result.task)));
		} catch {
			return null;
		}
	}

	/** When a file was last written, or null where it cannot be asked. */
	function writtenAt(file: string): number | null {
		try {
			return statSync(file).mtimeMs;
		} catch {
			return null;
		}
	}

	/**
	 * The tabs told where the specs stand, if it has changed since they were last
	 * told. Writing a document and writing the record beside it are two changes a
	 * moment apart that often mean one thing, and a tab that opens a document
	 * because it is waiting must not be told twice that it is.
	 */
	let saidSpecs = "";
	function saySpecs(): void {
		const msg = specs();
		const said = JSON.stringify(msg);
		if (said === saidSpecs) return;
		saidSpecs = said;
		broadcast(msg);
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

	/**
	 * Which files the repository holds, as git last listed them — see repoFiles.ts.
	 * Null for a folder that is in no repository, and until git has first answered.
	 *
	 * Kept rather than asked for where it is wanted: git is a process, the answer
	 * does not change between turns, and a tab connecting cannot wait on one.
	 */
	let repo: Repo | null = null;
	void loadRepo();
	void loadResults();

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
		// A document has no log and no tab: the only news is that it is there or not.
		if (documentAt(CWD, path)) {
			if (notes.sawDocument(path, existsSync(join(CWD, path)))) broadcast(files());
			return;
		}
		// A spec has a tab and no log, and is in no list: the tabs hear it whole —
		// the agent writes one with its own tools, so this is how its words arrive.
		if (specAt(CWD, path)) {
			const had = known.get(path);
			const found = spec(path);
			if (!found) {
				if (known.delete(path)) broadcast({ type: "note_gone", path });
			} else if (found.modified !== had) broadcast(found);
			// A document written, or changed after it was approved, moves what the
			// spec is waiting on — including when the write was this app's own and
			// the tabs have the words already.
			saySpecs();
			// And a box checked is a task's run ending, whose commit follows it.
			loadResultsSoon();
			return;
		}
		// The record itself: nothing opens it, and all it can change is where the
		// spec stands.
		if (specRecordAt(CWD, path)) {
			saySpecs();
			return;
		}
		// A file somebody has open to read, sent to them again. After the three
		// above, so a tab that asked for a path which is also a note or a spec
		// cannot stand in front of what that path really is; nothing else here
		// answers for a file that is neither.
		const looking = [...reading].filter(([, at]) => at === path).map(([ws]) => ws);
		if (looking.length > 0) {
			const text = safeStringify(code(path));
			for (const ws of looking) if (ws.readyState === ws.OPEN) ws.send(text);
			return;
		}
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
		const { appended } = settleDisk(path, found.text, Date.now());
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
			// From the reading of the log this already needed: a share costs nothing
			// on top of it, and a note that pi has just written in should not have
			// to be reopened before the strip says so.
			const msg: NoteChangedMsg = {
				type: "note_changed",
				path,
				base,
				modified: found.modified,
				lines: said.lines,
				changes,
				original: toDecide(said.holed),
				authored: shareOf(said.replayed.spans, found.text.length),
			};
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
	/** Whether the agent is in the middle of a turn, and when this folder was last looked at or heard from — for idle.ts. */
	let working = false;
	let seen = Date.now();

	/**
	 * Which file of the repository each tab has open to read — what to send it
	 * again when that file changes on disk (CodeMsg). One path per tab, since one
	 * tab is in front and the middle column draws only what is in front.
	 *
	 * Beside the sockets because it is a fact about a window looking, true only
	 * while it is: the entry goes when the tab closes the file, and with the
	 * socket when the window does. It is also what narrows the watcher, which
	 * would otherwise wake for every file a build or a checkout writes.
	 */
	const reading = new Map<WebSocket, string>();

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

	// The person's GitHub sign-in, changed in Settings while this server runs:
	// what git and gh run with from now on — see standing.ts.

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

	/** What the run was last said to be, so that a message ending mid-run is told only when that changes. */
	let saidRun = "";

	function onEvent(event: AgentSessionEvent): void {
		broadcast(toWireEvent(event));
		// The run's turn is over: the mark it carried is not a run any more.
		if (event.type === "agent_settled") runOver = taskMarkEntry(session().sessionManager.buildContextEntries())?.id ?? runOver;
		// The mark is written into the session as the turn's first messages end,
		// which may be after agent_start was told: a message ending is looked at
		// for the run having appeared, and the tabs told only when it has.
		if (event.type === "message_end") {
			const now = JSON.stringify(runOf());
			if (now !== saidRun) broadcast(config());
		}
		// isStreaming and the queue drive the stop button and pending count.
		if (
			event.type === "agent_start" ||
			event.type === "agent_settled" ||
			event.type === "queue_update" ||
			event.type === "compaction_start" ||
			event.type === "compaction_end"
		) {
			broadcast(config());
		}
		// Whether the agent is in the middle of a turn here: the server does not
		// let go of a folder mid-turn (idle.ts), and the shell does not remove
		// one — it is told, and it listens (main.js).
		if (event.type === "agent_start" || event.type === "agent_settled") {
			working = event.type === "agent_start";
			seen = Date.now();
			if (process.connected) process.send?.({ busy: working, folder: CWD });
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
		// And it may have written a file that is not a note at all, which is what
		// a spec's task writes. git is asked the same question at the same moment.
		if (event.type === "agent_settled") void loadRepo();
		if (event.type === "agent_settled") void loadResults();
		if (event.type === "agent_settled") void sayStanding();
		// A finished turn is the first moment there can be something to name the
		// session by, and each one after is another chance while there is not.
		if (event.type === "agent_settled") void nameSession();
	}

	/**
	 * The session a name is being asked for right now. Only while the question is
	 * out: two turns that end close together would otherwise ask twice. A question
	 * that came back with nothing is asked again when the next turn ends, with
	 * that turn in it — nothing was the answer because there was nothing yet.
	 */
	let namingFor: string | null = null;

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
		if (named.sessionName || namingFor === named.sessionId) return;
		// Words only: a message that only reached for a tool, or only thought, has
		// none, and an empty line would tell the model nothing.
		const said = named.messages.flatMap((m) =>
			m.role === "user" || m.role === "assistant" ? [{ role: m.role, text: textOf(m.content).trim() }] : [],
		).filter((s) => s.text);
		if (!said.some((s) => s.role === "user") || !said.some((s) => s.role === "assistant")) return;
		namingFor = named.sessionId;
		try {
			const name = await askForName({
				cwd: CWD,
				agentDir: getAgentDir(),
				modelRuntime,
				models: availableModels(),
				said,
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
		} finally {
			if (namingFor === named.sessionId) namingFor = null;
		}
	}

	let unsubscribe: (() => void) | undefined;

	/**
	 * Rebind after the runtime swaps in a different AgentSession.
	 *
	 * What is bound is what pi's own headless host binds: a screen for an
	 * extension to ask on (extensionUI.ts), the session moves a command may make,
	 * and where an extension's failure is said. A move made from a command swaps
	 * the session under this server the way the browser's own commands do, so it
	 * is followed by the same rebind and the same broadcast.
	 */
	async function bind(): Promise<void> {
		unsubscribe?.();
		const swapped = async () => {
			await bind();
			await broadcastAll();
		};
		await session().bindExtensions({
			uiContext: extensionUI(prompts, broadcast),
			commandContextActions: {
				waitForIdle: () => session().waitForIdle(),
				newSession: async (options) => {
					const result = await runtime.newSession({
						...options,
						// On the person's mode, as a session opened from the window is
						// (new_session below). Here rather than after, because the caller
						// may send the session its first message — /spec-run starts a task
						// this way — and a turn begun before this would run on pi's own
						// four tools, handing the agent a shell the person did not ask for.
						withSession: async (replaced) => {
							openOnDefaultMode();
							await options?.withSession?.(replaced);
						},
					});
					if (!result.cancelled) await swapped();
					return result;
				},
				fork: async (entryId, options) => {
					const result = await runtime.fork(entryId, options);
					if (!result.cancelled) await swapped();
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session().navigateTree(targetId, options);
					if (!result.cancelled) await broadcastAll();
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => {
					const result = await runtime.switchSession(sessionPath, options);
					if (!result.cancelled) await swapped();
					return result;
				},
				reload: async () => {
					await session().reload();
					await broadcastAll();
				},
			},
			onError: (err) => broadcast({ type: "error", message: `Extension "${err.extensionPath}" ${err.event}: ${err.error}` }),
		});
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
	 * The web is off in it, whatever the mode: a search sends words off this
	 * machine, and that begins when the person says so — the switch is beside the
	 * modes (toolModes.ts).
	 *
	 * Resumed sessions are left alone: they open the way they were left.
	 */
	function openOnDefaultMode(): void {
		const available = session()
			.getAllTools()
			.map((tool) => tool.name);
		session().setActiveToolsByName(withWeb(modeToolNames(readSettings().toolMode, available), available, false));
	}

	/** Push the full server state to every client. Used after a session is replaced. */
	async function broadcastAll(): Promise<void> {
		broadcast(config());
		broadcast(usage());
		broadcast(contextSources());
		broadcast(commands());
		broadcast(snapshot());
		for (const msg of diagnostics()) broadcast(msg);
		broadcast(branches());
		broadcast(files());
		broadcast(await sessions());
	}

	/**
	 * What pi had to say while setting the session up — an extension that failed
	 * to register a provider, a flag it did not know. pi's terminal prints these
	 * under its header; here they go after the snapshot, as errors in the
	 * conversation, since a snapshot replaces what came before it. Information
	 * is not a problem, so only what is.
	 */
	function diagnostics(): ErrorMsg[] {
		// An extension that failed to load, or lost a tool to a name clash, is in
		// the loader's errors rather than the runtime's diagnostics; pi's terminal
		// prints both, in this wording.
		const loading = runtime.services.resourceLoader
			.getExtensions()
			.errors.map((e) => ({ type: "error" as const, message: `Extension "${e.path}" error: ${e.error}` }));
		return [...runtime.diagnostics.filter((d) => d.type !== "info").map((d) => ({ type: "error" as const, message: d.message })), ...loading];
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

	/** A request for this folder: the app's own API, or a file of the folder's. The built page is the server's (server.ts). */
	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		seen = Date.now();
		const url = new URL(req.url ?? "/", "http://localhost");
		const { pathname } = url;

		if (pathname.startsWith("/api/")) {
			const json = (code: number, body: unknown) => {
				res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
				res.end(JSON.stringify(body));
			};
			// A change to the settings: the fields named, laid over what is on disk
			// (see updateSettings). What was asked wrongly and what could not be
			// written are told apart, since only one of them is worth asking again.
			if (pathname === "/api/attachment" && req.method === "POST") {
				const origin = req.headers.origin;
				if (origin && URL.parse(origin)?.host !== req.headers.host) return json(403, { error: "not from this app" });
				if (req.headers["content-type"] !== "application/octet-stream") return json(415, { error: "expected application/octet-stream" });
				if (Number(req.headers["content-length"] ?? 0) > MAX_BYTES) return json(413, { error: "too large" });
				let body: Buffer;
				try {
					body = await bytes(req, MAX_BYTES);
				} catch {
					return json(413, { error: "too large" });
				}
				let saved: Saved;
				try {
					saved = saveAttachment(CWD, url.searchParams.get("name") ?? "", body, url.searchParams.get("from") ?? "");
				} catch (err) {
					console.error("could not save an attachment:", err instanceof Error ? err.message : err);
					return json(500, { error: "could not save the file" });
				}
				if (!saved.ok) {
					const refusal = { name: [400, "not a usable file name"], kind: [415, "not a kind of file Octave takes"], size: [413, "empty or too large"] } as const;
					return json(refusal[saved.reason][0], { error: refusal[saved.reason][1] });
				}
				// The watcher would say so in a moment; whoever dropped it is about to
				// name it, so the list hears now.
				if (documentAt(CWD, saved.path) && notes.sawDocument(saved.path, true)) broadcast(files());
				return json(201, { path: saved.path });
			}
			if (req.method !== "GET") return json(405, { error: "read only" });
			if (pathname === "/api/models") return json(200, catalog());
			// A note's text as it is on disk, for an embed of it in another note.
			// Read only, and only a note in the folder (readNote → noteAt).
			if (pathname === "/api/note") {
				const found = readNote(CWD, url.searchParams.get("path") ?? "");
				return found ? json(200, { path: found.path, text: found.text }) : json(404, { error: "no such note" });
			}
			// What changed in a version, in the words of CHANGELOG.md — the file
			// ships beside dist-server (electron-builder.yml), and the section is
			// cut the way the release script cuts it. The page shows this after an
			// update, rather than the HTML GitHub hands the updater.
			if (pathname === "/api/changelog") {
				const version = url.searchParams.get("version") ?? "";
				if (!/^\d+\.\d+\.\d+$/.test(version)) return json(400, { error: "expected ?version=x.y.z" });
				// Beside server.ts when run from the repo, one up from dist-server/ in
				// the app — the same two places CLIENT_DIR is looked for in.
				const file = [new URL("CHANGELOG.md", import.meta.url), new URL("../CHANGELOG.md", import.meta.url)].find((u) => existsSync(u));
				if (!file) return json(404, { error: "no changelog beside this server" });
				const changelog = readFileSync(file, "utf8");
				const notes = sectionFor(changelog, version);
				return notes === null ? json(404, { error: `no section for ${version}` }) : json(200, { version, notes });
			}
			return json(404, { error: "not found" });
		}

		// A picture in the folder, for the note that shows it: found as Obsidian
		// would find it (pictures.ts), and only ever an image inside the folder
		// — pi's tools reach every file, the page is handed pictures.
		if (pathname.startsWith("/vault/")) {
			let given: string;
			try {
				given = decodeURIComponent(pathname.slice("/vault/".length));
			} catch {
				res.writeHead(400).end("Bad path");
				return;
			}
			// A picture a note refers to, or a document by its own path: what the tab
			// that shows a PDF reads (Pdf.tsx). A document is named exactly, never
			// looked for by name, since nothing embeds one yet.
			const document = documentAt(CWD, given);
			const found = attachmentAt(CWD, given, url.searchParams.get("from") ?? "") ?? (document ? { full: join(CWD, document), type: documentType(document)! } : null);
			if (!found) {
				res.writeHead(404).end("Not found");
				return;
			}
			try {
				const body = await readFile(found.full);
				res.writeHead(200, { "content-type": found.type, "cache-control": "no-cache" });
				res.end(body);
			} catch {
				res.writeHead(404).end("Not found");
			}
			return;
		}

		res.writeHead(404).end("Not found");
	}

	/** A tab connected: told everything it needs to start, and listened to from then on. */
	async function attach(ws: WebSocket): Promise<void> {
		clients.add(ws);
		seen = Date.now();
		// Someone is looking: a list that has gone stale since the last pass is
		// brought up to date, and this tab hears of it like every other.
		void refreshModels();
		ws.on("close", () => {
			clients.delete(ws);
			reading.delete(ws);
			seen = Date.now();
		});
		// ws emits 'error' for a malformed frame. Node throws on an 'error' event
		// with no listener, so without this one bad frame takes the process down.
		ws.on("error", (err) => {
			console.error("websocket error:", err.message);
			clients.delete(ws);
			reading.delete(ws);
		});
		/** To this tab only: answers to what it asked, and the state it needs to start. */
		const reply = (msg: ServerMsg) => ws.send(safeStringify(msg));
		reply(config());
		reply(providers());
		reply(settingsNow());
		reply(usage());
		reply(contextSources());
		reply(commands());
		reply(snapshot());
		for (const msg of diagnostics()) reply(msg);
		reply(branches());
		notes.load();
		reply(files());
		// What git last said, at once; and git asked again, which reaches every tab
		// if the answer has moved on since the last turn ended.
		reply(repoMsg());
		void loadRepo();
		void loadResults();
		reply(specs());
		void sayStanding(reply);
		reply({ type: "property_types", types: propertyTypes.all() });
		reply({ type: "property_names", ...propertyNames.all() });
		// A tab opened while a question is waiting should see it too.
		for (const prompt of prompts.open()) reply({ type: "prompt_request", prompt });
		const asking = logins.open();
		if (asking) reply({ type: "login_prompt", prompt: asking });

		ws.on("message", async (data) => {
			seen = Date.now();
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
								? {
										path: msg.note,
										chosen: typeof msg.chosen === "string" && msg.chosen ? msg.chosen : null,
										// Digits and a dash, since it is said to pi as it came.
										...(typeof msg.page === "string" && /^\d{1,6}(-\d{1,6})?$/.test(msg.page) ? { page: msg.page } : {}),
									}
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
							// What was typed is what is sent. Left to itself, prompt() reads a
							// leading "/" as a command — an extension's, a skill's, a prompt
							// template's — and runs or rewrites it before anyone sees. Only a
							// command chosen from the list the server sent (CommandsMsg) is
							// one; a "/" typed by hand is a character. (prompt() also throws
							// if the session is streaming and no behavior is given.)
							await session().prompt(text, {
								expandPromptTemplates: msg.command === true,
								...(msg.images?.length ? { images: msg.images.map((i) => ({ type: "image" as const, ...i })) } : {}),
								...(session().isStreaming ? { streamingBehavior: behavior } : {}),
							});
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
						// message, and re-queueing the survivors through steer() would send
						// them through pi's command expansion, which prompt() above is told
						// to skip.
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
						// What pi's /tree asks before it moves: whether the branch being
						// left should be summarised into the one being joined, so what was
						// found there is not lost. The same card as any question, and the
						// same setting as pi's to stop asking (branchSummary.skipPrompt,
						// which means no summary). Closing the card is not moving.
						// The third answer is the one a terminal's list has no room for:
						// it turns the setting off from where the question got tiresome.
						let summarize = false;
						if (!session().settingsManager.getBranchSummarySkipPrompt()) {
							try {
								const answer = await prompts.ask({
									type: "select",
									question: "Summarize branch?",
									options: ["No summary", "Summarize", "No summary, don't ask again"],
								});
								summarize = answer === "Summarize";
								if (answer === "No summary, don't ask again") {
									await setBranchSummarySkipPrompt(true);
									broadcast(config());
								}
							} catch (err) {
								if (err instanceof Cancelled) return;
								throw err;
							}
						}
						const result = await session().navigateTree(msg.entryId, { summarize });
						if (result.cancelled) return;
						if (result.aborted) {
							reply({ type: "notice", text: "Branch summarization cancelled" });
							return;
						}
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

					// pi's /compact, by hand: the conversation so far is summarised into
					// less, the way it would be when the window fills. The events it
					// emits are the ones the conversation already draws a notice for.
					case "compact":
						if (session().isStreaming) {
							reply({ type: "error", message: "Wait for the reply to finish before compacting." });
							return;
						}
						try {
							await session().compact();
						} catch (err) {
							reply({ type: "error", message: err instanceof Error ? err.message : String(err) });
						}
						break;

					case "abort_compaction":
						session().abortCompaction();
						break;

					// A session file to the bin, as pi's own picker does it. Not the one
					// that is open: pi would go on writing to a file that is gone.
					case "delete_session": {
						if (typeof msg.path !== "string") return;
						if (msg.path === session().sessionFile) {
							reply({ type: "error", message: "The open session cannot be deleted; open another first." });
							return;
						}
						const known = (await sessions()).sessions.some((s) => s.path === msg.path && !s.current);
						if (!known) {
							reply({ type: "error", message: `unknown session: ${msg.path}` });
							return;
						}
						try {
							await deleteSessionFile(msg.path);
						} catch (err) {
							reply({ type: "error", message: `could not delete: ${err instanceof Error ? err.message : String(err)}` });
							return;
						}
						broadcast(await sessions());
						break;
					}

					// pi's /fork: a new session with everything up to this user message
					// copied in, and the message itself handed back as text — sent as it
					// was, or changed first. The session under this server is swapped,
					// so what follows is what follows any swap.
					case "fork": {
						if (typeof msg.entryId !== "string") return;
						if (session().isStreaming) {
							reply({ type: "error", message: "Wait for the reply to finish before forking." });
							return;
						}
						prompts.cancelAll();
						settle("interrupted");
						const result = await runtime.fork(msg.entryId);
						if (result.cancelled) return;
						await bind();
						await broadcastAll();
						if (result.selectedText) reply({ type: "queue_cleared", steering: [result.selectedText], followUp: [] });
						break;
					}

					// pi's /clone: the current branch, whole, into a new session file,
					// and that session opened — the open one is left where it is. In pi
					// this is a fork at the leaf rather than before it, which is how its
					// own RPC host does it; what follows is what follows any swap.
					case "clone_session": {
						if (session().isStreaming) {
							reply({ type: "error", message: "Wait for the reply to finish before cloning." });
							return;
						}
						const leafId = session().sessionManager.getLeafId();
						if (!leafId) {
							reply({ type: "error", message: "Nothing to clone yet - start a conversation first" });
							return;
						}
						prompts.cancelAll();
						settle("interrupted");
						const result = await runtime.fork(leafId, { position: "at" });
						if (result.cancelled) return;
						await bind();
						await broadcastAll();
						break;
					}

					// pi's /export, into the vault's own .pi/exports rather than the
					// folder of notes, where an HTML file would be a stranger. Where it
					// went is said in the conversation, as pi's status line says it.
					case "export_session": {
						if (msg.format !== "html" && msg.format !== "jsonl") return;
						const dir = join(CWD, ".pi", "exports");
						mkdirSync(dir, { recursive: true });
						const stamp = new Date().toISOString().replace(/[:.]/g, "-");
						const target = join(dir, `session-${session().sessionId.slice(0, 8)}-${stamp}.${msg.format}`);
						try {
							const written = msg.format === "html" ? await session().exportToHtml(target) : session().exportToJsonl(target);
							reply({ type: "notice", text: `Session exported to ${written}` });
						} catch (err) {
							reply({ type: "error", message: `could not export: ${err instanceof Error ? err.message : String(err)}` });
						}
						break;
					}

					// One of pi's settings, through pi's setter: it writes pi's
					// settings.json, and pi reads the value at the moment it matters,
					// so nothing here has to be told. Every tab sees the new value.
					case "set_setting": {
						const m = session().settingsManager;
						switch (msg.setting) {
							case "compaction.enabled":
								if (typeof msg.value !== "boolean") return;
								m.setCompactionEnabled(msg.value);
								break;
							case "retry.enabled":
								if (typeof msg.value !== "boolean") return;
								m.setRetryEnabled(msg.value);
								break;
							case "hideThinkingBlock":
								if (typeof msg.value !== "boolean") return;
								m.setHideThinkingBlock(msg.value);
								break;
							case "branchSummary.skipPrompt":
								if (typeof msg.value !== "boolean") return;
								await setBranchSummarySkipPrompt(msg.value);
								break;
							case "projectTrust":
								if (typeof msg.value !== "boolean") return;
								await setProjectTrust(msg.value);
								// What is loaded changed with it: the commands, the context.
								await broadcastAll();
								return;
							default:
								return;
						}
						broadcast(config());
						break;
					}

					// pi's /reload: skills, prompt templates, settings and context files
					// read again, for what was added since the session began.
					case "reload":
						await session().reload();
						await broadcastAll();
						break;

					case "set_session_name":
						if (typeof msg.name !== "string") return;
						session().setSessionName(msg.name);
						broadcast(config());
						broadcast(await sessions());
						break;

					case "ask_standing":
						void sayStanding(reply);
						break;

					case "open_note": {
						if (typeof msg.path !== "string") return;
						// A spec is opened by the same message into the same editor; only the answer differs.
						const found = specAt(CWD, msg.path) ? spec(msg.path) : note(msg.path);
						if (!found) {
							reply({ type: "note_gone", path: msg.path });
							return;
						}
						reply(found);
						break;
					}

					// A file of the repository, to read and not to write. A door of
					// its own rather than open_note's, because what comes back is
					// not a note and the folder answers for a different set of paths.
					case "open_code": {
						if (typeof msg.path !== "string") return;
						reading.set(ws, msg.path);
						reply(code(msg.path));
						break;
					}

					// The tab has gone, or has moved to something that is not a file.
					case "close_code":
						reading.delete(ws);
						break;

					// A commit, to read what it changed. What is asked for is checked
					// where it is read (commitRead.ts): a hash and nothing else.
					case "open_commit": {
						const asked = typeof msg.commit === "string" ? msg.commit : "";
						const read = await readCommit(CWD, asked);
						reply(read ? { type: "commit", asked, ...read } : { type: "commit_gone", asked });
						break;
					}

					// The editor's save. Refused rather than merged when the note has
					// moved on since it was read — see vault.ts — and recorded to the
					// note's history as mine when it lands.
					case "save_note": {
						if (typeof msg.path !== "string" || typeof msg.text !== "string") return;
						const base = typeof msg.base === "number" ? msg.base : null;
						// A spec is held to the same version as a note — refused over one
						// the agent has written since — and that is all: no record of
						// whose the words are, and no list that has it to tell.
						const isSpec = specAt(CWD, msg.path) !== null;
						const had = isSpec ? null : readNote(CWD, msg.path);
						const written = isSpec ? writeSpec(CWD, msg.path, msg.text, base) : writeNote(CWD, msg.path, msg.text, base);
						if (!written.ok) {
							if (written.reason === "conflict") reply({ type: "note_conflict", path: msg.path, modified: written.modified });
							else if (written.reason === "missing") reply({ type: "note_gone", path: msg.path });
							else reply({ type: "error", message: `cannot save ${msg.path}` });
							return;
						}
						if (isSpec) {
							const saved = spec(msg.path);
							if (saved) broadcast(saved);
							break;
						}
						const edits = Array.isArray(msg.edits) ? msg.edits : undefined;
						const changes = record(CWD, msg.path, had?.text ?? "", msg.text, { author: "me", at: Date.now() }, edits);
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
						const text = born(typeof msg.text === "string" ? msg.text : "");
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
						const { replayed } = settleDisk(msg.path, found.text, Date.now());
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
						const { replayed } = settleDisk(msg.path, found.text, Date.now());
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
							const { holed } = settleDisk(path, found.text, at);
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
	}


	// Writes that do not pass through here — see watcher.ts. A file is watched
	// only while a tab has it open, which is what `reading` is for.
	const stopWatching = watchNotes(CWD, noticed, undefined, (path) => [...reading.values()].includes(path));


	/** Everything of this folder's let go: the watcher, the questions open, the session, the tabs. */
	async function dispose(): Promise<void> {
		stopWatching();
		prompts.cancelAll();
		logins.cancel();
		await runtime.dispose();
		// server.close() waits for open connections, and an upgraded WebSocket is
		// one of them. ws does not close them for us when the http server was
		// passed in, so a browser tab left open would hang the exit.
		for (const client of clients) client.terminate();
	}

	return {
		cwd: CWD,
		handle,
		attach,
		broadcast,
		dispose,
		/** The settings were written (server.ts): every tab of this folder hears them, and the config drawn from them. */
		settingsChanged: (written: SettingsMsg) => {
			broadcast(written);
			broadcast(config());
		},
		/** For the line printed as the server comes up. */
		status: () => ({ model: currentModel()?.id ?? "none", thinking: session().thinkingLevel, sessionFile: session().sessionFile }),
		/** Whether this folder can be let go of for now — see idle.ts. */
		idleness: () => ({ busy: working, watched: clients.size, since: seen }),
	};
}
