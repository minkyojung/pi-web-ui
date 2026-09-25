/**
 * What the socket carries, said once for both ends.
 *
 * Two unions, the way pi's own rpc mode declares its commands and responses:
 * one object per message, told apart by `type`, so a `switch` on it narrows
 * the fields on either side. The server annotates the functions that build
 * these with the message types, and the client sends and receives them by
 * type — a field one end adds or renames without the other is then a compile
 * error rather than an `undefined` on screen.
 *
 * Shared at the repo root like toolModes.ts. Types only: the client bundles
 * this, so nothing here may run.
 */
import type { SpecDoc } from "./documentKinds.ts";
import type { Suggestions } from "./properties.ts";
import type { PropertyType, Registry } from "./propertyTypes.ts";
import type { Ask, AskOutcome } from "./ask";
import type { BranchPoint } from "./branches";
import type { Author, Change, Edit, Moved } from "./history";
import type { NoteFile } from "./vault";
import type { Backlink, Tagged } from "./linkIndex";
import type { SearchHit } from "./search";
import type { Settings } from "./settings.ts";
import type { CommitFile, CommitRead, WorkingEntry } from "./commitRead.ts";
import type { Outgoing } from "./standing.ts";
import type { TaskResult } from "./specResults.ts";
import type { TaskRun } from "./specRuns.ts";
import type { TaskRead } from "./taskRead.ts";
import type { Progress } from "./specTasks.ts";

/** Octave's own settings, for the client, which cannot import settings.ts for anything but its type. */
export type { Settings };

export type { Ask, AskOutcome, Author, Backlink, BranchPoint, Change, Edit, Moved, NoteFile, SearchHit, Tagged };

// ---------------------------------------------------------------------------
// Browser → server

export type ClientMsg =
	| {
			type: "prompt";
			text: string;
			/**
			 * The text names a command — one from CommandsMsg, chosen from the
			 * list — and pi is to run or expand it. Without this a leading "/"
			 * is a character like any other, however it was typed.
			 */
			command?: boolean;
			/** Images pasted into the box: base64 and a media type, as pi's ImageContent has them. */
			images?: { data: string; mimeType: string }[];
			/** What to do with it mid-run. Ignored when nothing is running. */
			behavior?: "steer" | "followUp";
			/** Asking again: the user message this one is an alternative to. */
			entryId?: string;
			/**
			 * The address of the tab in front when this was sent — a file's path,
			 * or a page of the app's own (`octave://task/…`, see pages.ts) — for pi
			 * to be told about this turn. Not part of the message.
			 */
			front?: string;
			/**
			 * The words chosen in that tab when this was sent, for pi to be told
			 * about this turn beside the tab itself. Like `front`, not part of the
			 * message: what is chosen when a question is asked again later is
			 * whatever is chosen then, which is nothing to do with this one.
			 */
			chosen?: string;
			/** Where in a document those words are — "3", "3-4" — when `front` is a PDF rather than a note. */
			page?: string;
			/**
			 * Asking about a chosen part of the open note rather than typing in the
			 * box: `text` is the question and this is what it is about. The chosen
			 * words are quoted into what pi is sent, and the answer is written into
			 * the note under them — see ask.ts. Answered with `ask_done`.
			 */
			ask?: Ask;
	  }
	| { type: "abort" }
	| { type: "clear_queue" }
	| { type: "set_tools"; names: string[] }
	/** `provider/id`, as config.models lists them. */
	| { type: "set_model"; model: string }
	| { type: "set_thinking"; level: string }
	/** The window came back: where the branch stands may have moved outside the app. */
	| { type: "ask_standing" }
	| { type: "new_session" }
	| { type: "resume_session"; path: string }
	| { type: "prompt_response"; id: string; answer?: string; cancelled?: boolean }
	| { type: "navigate"; entryId: string }
	| { type: "set_session_name"; name: string }
	| ({ type: "set_setting" } & PiSetting)
	/** Read the skills, prompt templates, settings and context files again. pi's /reload. */
	| { type: "reload" }
	/** Summarise the conversation so far into less, now rather than when it fills. pi's /compact. */
	| { type: "compact" }
	| { type: "abort_compaction" }
	/** A session other than the open one, to the bin (or unlinked where there is none), as pi's picker does. */
	| { type: "delete_session"; path: string }
	/** A new session that begins at this user message, with all before it. pi's /fork. */
	| { type: "fork"; entryId: string }
	/** A new session with the whole of the current branch copied in, the open one left as it is. pi's /clone. */
	| { type: "clone_session" }
	/** The session as a file in the vault's .pi/exports, in the shape asked for. pi's /export. */
	| { type: "export_session"; format: "html" | "jsonl" }
	/** A note, or a spec, to look at. Answered with `note` (a SpecMsg for a spec), or `note_gone` if there is no such note. */
	| { type: "open_note"; path: string }
	/**
	 * A file of the repository to read in a tab, which is not a note and is
	 * not written from here. Answered with `code`, or `code_gone` where there
	 * is nothing to show.
	 *
	 * A watch as well as an ask, the way an editor's didOpen is: while a tab
	 * has a file open, a write to it on disk — a task's, a branch changed
	 * underneath — comes back as another `code`. One file at a time, since one
	 * tab is in front; `close_code` ends it, and so does the socket.
	 */
	| { type: "open_code"; path: string }
	/** The file is no longer open here. Nothing is watched for this tab until it asks again. */
	| { type: "close_code" }
	/**
	 * A commit, to read what it changed (commitRead.ts): its hash, whole or
	 * short, and nothing else — not a branch, not `HEAD~1`. Answered with a
	 * `commit`, or a `commit_gone` when there is no such commit here. Asked
	 * and not watched: a commit does not change.
	 */
	| { type: "open_commit"; commit: string }
	/**
	 * A task, to look at what its run said and changed (taskRead.ts): in
	 * review, the session's last answer and the folder's changes; accepted,
	 * its commit. Answered with a `task`, or a `task_gone` for one never run
	 * here. Asked and not watched: the tab asks again when the specs move.
	 */
	| { type: "open_task"; spec: string; task: string }
	/**
	 * What is on this machine and not on origin, listed: the files changed
	 * and not committed, and the commits a push would send — what the list
	 * at the foot of the window shows (commitRead.ts listWorking, standing.ts
	 * outgoingIn). Answered with a `work`. Asked when the list opens, and
	 * again while it is open whenever the standing moves.
	 */
	| { type: "ask_work" }
	/**
	 * The files changed and not committed, each before and after — the
	 * Changes page (commitRead.ts readWorking). Answered with `changes`.
	 * Asked when the page opens, and again whenever the standing moves.
	 */
	| { type: "open_changes" }
	/**
	 * A note's whole text, on top of the version it was read at — `base` is
	 * that version's `modified`, or null for a note that did not exist yet.
	 * `edits` is what the editor did to that version to get here, in its
	 * coordinates, side by side; the record takes them as they are when they
	 * add up to `text`, and reads the change off the two texts when they do
	 * not (fromEdits in history.ts). Answered with `note` to every tab, or
	 * `note_conflict` to this one. A spec is saved the same way, less the
	 * record: `edits` is not read, and the answer is its SpecMsg.
	 */
	| { type: "save_note"; path: string; text: string; base: number | null; edits?: Edit[] }
	/**
	 * What the person decided about the words at [from, to): `kept` absent or
	 * true for fine as they are, false for back to being looked at, which is
	 * what taking the decision back means in an append-only log. Answered with
	 * `note` to every tab.
	 */
	| { type: "accept_note"; path: string; from: number; to: number; kept?: boolean }
	/**
	 * A new, empty note. Named by the server unless `name` is given — a title,
	 * as the title field takes one — and refused with `note_rename_failed` if
	 * that name is taken or not a note's. Answered with `note_created` to this
	 * tab and `note` to every tab.
	 */
	| { type: "new_note"; name?: string; text?: string }
	/** Give a note another path. Answered with `note_renamed` to every tab, or `note_rename_failed` to this one. */
	| { type: "rename_note"; path: string; to: string }
	/** Put a note in the trash. Answered with `note_deleted` to every tab. */
	| { type: "delete_note"; path: string }
	/**
	 * Who wrote which words of this note. Answered with `authors` to this tab.
	 *
	 * Asked rather than sent with the note: it is a question someone puts, not
	 * a thing the note is always carrying, and an answer that had to follow
	 * every keystroke would be a different feature with a different cost.
	 */
	| { type: "who_wrote"; path: string }
	/**
	 * Everything about the run of the note at `pos`: who wrote it, when, what
	 * stood there before, and — for pi — which model and the question the turn
	 * began with. Asked when someone clicks a marked run. Answered with `why`.
	 */
	| { type: "why_wrote"; path: string; pos: number }
	/** Bring a trashed note back to its path. Answered with `note_created` to this tab and `note` to every tab. */
	| { type: "restore_note"; trashed: string; path: string }
	/**
	 * Every note's text, for `query`. Answered with `search_results` to this
	 * tab; `id` is the tab's own count of asks, sent back so an answer that
	 * arrives after a newer ask can be told apart and dropped.
	 */
	| { type: "search_notes"; query: string; id: number }
	/** Choose what kind of thing the property `name` holds, vault-wide; null lets it be guessed from its values again. */
	| { type: "set_property_type"; name: string; propertyType: PropertyType | null }
	/** Sign in to a provider one of the ways `providers` says it can be. What pi then asks comes as login_prompt. See login.ts. */
	| { type: "login"; provider: string; method: "oauth" | "api_key" }
	/** A tab's answer to a login_prompt, by its id. */
	| { type: "login_answer"; id: string; value: string; cancelled?: false }
	/** The whole sign-in given up — with or without a question open, so no id. pi hears its signal abort. */
	| { type: "login_answer"; cancelled: true; id?: string }
	/** Forget the credential pi keeps for a provider. One it found elsewhere (an environment variable) is not pi's to forget. */
	| { type: "logout"; provider: string }
	/**
	 * Put back what pi wrote in one run: every note pi wrote to in `session`
	 * between `from` and `to` (ms) has its undecided changes of pi's put
	 * back, as one edit of the person's per note. What the person has kept,
	 * and what they wrote themselves, stays. Answered with `run_undone` to
	 * this tab, and `note_changed` to every tab for each note that moved.
	 */
	| { type: "undo_run"; session: string; from: number; to: number };

export type ClientMsgType = ClientMsg["type"];

// ---------------------------------------------------------------------------
// Server → browser

/** Mirrors the Item typedef in conversation.js, which is plain JS with JSDoc. */
export interface Item {
	kind: "user" | "assistant" | "thinking" | "tool" | "error" | "done" | "notice";
	text?: string;
	name?: string;
	args?: unknown;
	result?: string | null;
	isError?: boolean;
	/**
	 * On a user message: where it sits in the session tree, which is how the
	 * alternatives the server found are matched to the message they belong to.
	 * Absent on a message folded from live events, which has none yet.
	 */
	entryId?: string;
	/**
	 * On a tool: what its result carried besides text. A projection of pi's
	 * `details`, not the thing itself — see detailsOf in conversation.js.
	 */
	details?: { diff?: string; omittedLines?: number; fullOutputPath?: string; limit?: number };
	/** ms, on `done`: when the run's first message was written, and its last. */
	startedAt?: number;
	endedAt?: number;
	/** On `done`: why the run's last message stopped, and what the run billed. */
	stopReason?: string;
	tokens?: number;
	cost?: number;
	/**
	 * On `thinking` and `tool`: which assistant message this step came from. A
	 * turn that calls tools is several assistant messages, and counting them is
	 * the one thing the steps cannot be asked — two thoughts in one message and
	 * two thoughts in two look identical without it.
	 */
	message?: number;
}

export interface SessionInfo {
	path: string;
	id: string;
	name: string | null;
	firstMessage: string;
	messageCount: number;
	/** ISO string; the server serialises the Date. */
	modified: string;
	current: boolean;
}

/** A model the picker offers, and what it will be thinking at when chosen. */
export interface ModelInfo {
	/** `provider/id` — what set_model takes. */
	key: string;
	/** The model's own name, as pi gives it: "GPT-5.6 Sol", not the id. */
	name: string;
	/**
	 * The levels this model offers, weakest first. The picker shows every level
	 * there is and greys the rest, so a model that cannot go to max is seen not
	 * to rather than quietly offered one step fewer.
	 */
	levels: string[];
	/**
	 * The level it is on — for the current model what it is thinking at now, and
	 * for the others what choosing them would put them at. pi keeps one of these
	 * per model, so each carries its own.
	 */
	level: string;
}

export interface ConfigMsg {
	type: "config";
	model: string | null;
	/** The loadout, in order, and the model the session is on. See models.ts. */
	models: ModelInfo[];
	/**
	 * Why `models` may be short, when it may be: a provider pi could not check
	 * just now, or pi's own report of trouble. See models.ts. Absent when the
	 * list is what it should be.
	 */
	modelsNotice?: string;
	tools: { name: string; description?: string }[];
	activeTools: string[];
	isStreaming: boolean;
	/** A compaction is being written; the box is closed to prompts until it is done. */
	isCompacting: boolean;
	/** pi's own settings that Octave shows a switch for. See PiSettings. */
	pi: PiSettings;
	queued: { steering: string[]; followUp: string[] };
	sessionId: string;
	sessionName: string | null;
	/**
	 * The task this session is running, while it is: the spec, the task's
	 * number and objective. Read off the mark
	 * the run carries in its session (spec.ts), for the turn that is the run;
	 * null at rest, and null in the turns after it, which are conversation.
	 * The one thing the strip's line cannot say from the events alone.
	 */
	run: { spec: string; task: string; title: string } | null;
	/** The folder the agent reads and writes in, in full. See CWD in server.ts. */
	folder: string;
	/** Where this server writes down what it says, so that a person can go and read it. See log.ts. */
	log: string;
}

/**
 * What pi keeps in its settings.json and Octave lets be switched from here,
 * read from pi's SettingsManager and written back through its setters — so
 * the terminal and this window see one value. The two thresholds are read
 * only: pi has no setter for them, and its own screen does not offer them.
 */
export interface PiSettings {
	compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
	/** Try a failed call again on its own, a few times with growing waits, before giving up. */
	retryEnabled: boolean;
	/** Leave the model's thinking out of the conversation; pi's terminal does the same with it. */
	hideThinkingBlock: boolean;
	/** Ask, before the arrows leave a branch, whether to summarise it into the one joined. The opposite of pi's branchSummary.skipPrompt. */
	askBranchSummary: boolean;
	/**
	 * Whether pi may read this folder's own .pi/ — settings, skills, prompts,
	 * SYSTEM.md — as a project's. "nothing" when the folder has none of those
	 * to trust. pi's trust.json, the answer its terminal's /trust keeps.
	 */
	projectTrust: "trusted" | "untrusted" | "nothing";
}

/** One of pi's settings, to be written through pi's setter for it. */
export type PiSetting =
	| { setting: "compaction.enabled"; value: boolean }
	| { setting: "retry.enabled"; value: boolean }
	| { setting: "hideThinkingBlock"; value: boolean }
	/** pi's key and pi's sense: true means no question and no summary. */
	| { setting: "branchSummary.skipPrompt"; value: boolean }
	/** Remembered in pi's trust.json for this folder, and read at once. */
	| { setting: "projectTrust"; value: boolean };

export interface UsageMsg {
	type: "usage";
	cost: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	messages: number;
	toolCalls: number;
	/** `percent` is null when pi has no count yet; the gauge draws "unknown" for it. */
	context: { tokens: number | null; window: number; percent: number | null } | null;
}

/**
 * A provider pi could run a model from, and whether it can now. This is what
 * pi's own /login screen is drawn from — providers.ts in server terms —
 * carried to the tab so the same screen can be drawn there.
 */
export interface ProviderInfo {
	/** pi's id for it: "anthropic", "openai". What login and logout take. */
	id: string;
	/** pi's name for it: "Anthropic". */
	name: string;
	/**
	 * The ways it can be signed in to here. pi's providers offer one or both;
	 * empty for one that can only be reached by a credential the machine
	 * already has, an environment variable say, which is then listed only
	 * while that credential is there.
	 */
	methods: ("oauth" | "api_key")[];
	/**
	 * Signed in now, and how, or null. `source` is pi's word for where the
	 * credential came from — "stored" for one it keeps, else the variable or
	 * file it was found in — so a key set outside the app is seen not to be
	 * something the app can sign out of.
	 */
	signedIn: {
		method: "oauth" | "api_key";
		source: string;
		/** The last characters of a key pi keeps, so the person can tell which one it is; never the key. */
		keyTail?: string;
	} | null;
}

/**
 * A question pi asks on the way to signing in — pi's AuthPrompt, with the
 * provider it is about and an id to answer by. `secret` is a key and is not to
 * be shown as typed; `manual_code` is what a person pastes back from a browser
 * when the callback did not reach pi; `select` chooses by option id.
 */
export type LoginPrompt = { id: string; provider: string; message: string; placeholder?: string } & (
	| { type: "text" }
	| { type: "secret" }
	| { type: "manual_code" }
	| { type: "select"; options: { id: string; label: string; description?: string }[] }
);

/** Something pi says on the way, not asked: the URL to open, a code to type at it, how it is going. pi's AuthEvent. */
export type LoginEvent =
	| { type: "info"; message: string; links?: { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
	| { type: "progress"; message: string };

export interface LoginPromptMsg {
	type: "login_prompt";
	prompt: LoginPrompt;
}

/** pi no longer needs the answer — the callback arrived first, say. */
export interface LoginPromptDismissMsg {
	type: "login_prompt_dismiss";
	id: string;
}

export interface LoginEventMsg {
	type: "login_event";
	provider: string;
	event: LoginEvent;
}

/** The sign-in ended. Not ok and no error is a cancel; `providers` follows when the credentials moved. */
export interface LoginDoneMsg {
	type: "login_done";
	provider: string;
	ok: boolean;
	error?: string;
}

/** Every provider worth listing, in pi's order. Sent on connect and whenever the credentials file moves. */
export interface ProvidersMsg {
	type: "providers";
	providers: ProviderInfo[];
}

/**
 * Octave's own settings, as settings.ts last wrote or read them. Sent on
 * connect and after every change, whichever tab made it, so a screen showing
 * them never builds an edit on a copy another window has since replaced. It is
 * also the answer to POST /api/settings.
 */
export interface SettingsMsg {
	type: "settings";
	settings: Settings;
	/**
	 * Which write they are: the nth since this run of the server began, and
	 * which run. The answer to a tab's own change and the news of another
	 * window's come on different connections and can arrive in either order;
	 * this is how the older is kept from being shown over the newer. A
	 * different run is a restart, whose count began again.
	 */
	revision: { boot: string; n: number };
}

/** Sizes of what fills the context besides the conversation. See contextBreakdown.ts. */
export interface ContextSourcesMsg {
	type: "context_sources";
	systemPromptChars: number;
	tools: { name: string; chars: number; active: boolean }[];
	skills: number;
	/** Extensions loaded from the person's own pi — not Octave's own, not pi-web-access. */
	extensions: number;
	memoryFiles: { count: number; chars: number };
	login: { oauth: boolean; subscription: boolean };
	/**
	 * The folder has a `.pi/` of its own — settings, skills, prompts, a
	 * SYSTEM.md — that pi reads only from a project it has been told to trust,
	 * and this one has not been. So none of it is in the context.
	 */
	untrusted: boolean;
}

/**
 * What a line beginning with "/" can name, as pi's own `get_commands` lists
 * it: a command an extension registered, a prompt template file, a skill (as
 * `skill:name`). pi's terminal-only commands (/model, /tree, …) are not
 * commands here, since they would not run if sent. Sent with the session's
 * state, since extensions are bound per session.
 */
export interface CommandInfo {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
}

export interface CommandsMsg {
	type: "commands";
	commands: CommandInfo[];
}

/**
 * Where the conversation being shown has alternatives. Computed by the server
 * from the session tree; see branches.ts.
 */
export interface BranchesMsg {
	type: "branches";
	nodes: BranchPoint[];
}

export interface SessionsMsg {
	type: "sessions";
	sessions: SessionInfo[];
}

/** The conversation so far, rebuilt from the session file. See snapshot() in server.ts. */
export interface SnapshotMsg {
	type: "snapshot";
	items: Item[];
}

/**
 * The notes in the working folder. See fileIndex.ts.
 *
 * Sent when the set of them changes — a note made, gone, or under a new name —
 * and not when one is written: nothing that reads this list can see a note's
 * text or when it was last touched.
 *
 * `truncated` says the folder held more than the walk would take, which is a
 * thing to say rather than to swallow: a note past that point is in the folder
 * but in no list, and would be missing from the tree and from a search of
 * every note with nothing to explain it. It means the folder is almost
 * certainly not a folder of notes.
 */
export interface FilesMsg {
	type: "files";
	files: NoteFile[];
	/** The documents beside the notes — files the agent reads as text, a PDF — by path, for naming one in a message. */
	documents: string[];
	truncated: boolean;
}

/**
 * Every file of the repository the folder is, as git lists them. See repoFiles.ts.
 *
 * Beside FilesMsg rather than in it, because they answer different questions
 * and are read by different things. The notes' list is what the tree draws,
 * what `[[` and `@` offer, and what a search of every note reads; a
 * repository's files are not notes and belong in none of those. This is the
 * palette's list — what `⌘P` can open, which in a repository is everything
 * in it — and it is also sent on its own beat: the notes' list changes on
 * every note made or gone, and resending a repository's thousands of paths
 * each time one did would be the cost of a feature nothing asked for.
 *
 * Sent when a tab connects, and again when the answer is not the one the tabs
 * have — asked after the agent settles, which is when a turn has written
 * files and when somebody is about to go and read them.
 */
export interface RepoMsg {
	type: "repo";
	/** From the top of the folder, forward slashes, in git's own order. Empty for a folder that is in no repository. */
	files: string[];
	/** The repository held more files than the list would take (repoFiles.ts's LIMIT), so this is not all of them. */
	truncated: boolean;
}

/**
 * A note as it is on disk, whole, with who wrote which of its words. The
 * answer to open_note, and what a tab falls back to when a change arrives on
 * a version it does not have.
 */
export interface NoteMsg {
	type: "note";
	path: string;
	text: string;
	modified: number;
	/**
	 * How long the note's log is at this text: the record's own version of
	 * it, which is what an edit that moved words names as where they came
	 * from (Moved). The disk's `modified` is a time; this is a place in the
	 * log, and the log is what is asked.
	 */
	lines: number;
	/**
	 * The note as it would be with every undecided change of pi's put back,
	 * when there are any — see unreviewed in history.ts. The editor shows the
	 * two as a diff to be decided about a chunk at a time; absent, there is
	 * nothing to decide and no diff.
	 */
	original?: string;
	/** The notes that link to this one, from the index. */
	backlinks: Backlink[];
	/** The notes that share a tag with this one, from the index. */
	tagged: Tagged[];
	/** How much of it somebody other than you wrote. See Authored. */
	authored: Authored;
	/** Absent on a note; see SpecMsg. */
	kind?: undefined;
}

/**
 * A spec (documentKinds.ts) as it is on disk, whole: the answer to open_note
 * for one, and what every tab is sent after any write to it, since a spec
 * keeps no log to say a change against. Everything else a note's message
 * carries is its log's or its links', and a spec has neither.
 */
export interface SpecMsg {
	type: "note";
	kind: "spec";
	path: string;
	text: string;
	modified: number;
}

/**
 * Where every spec in the folder stands: what the person has approved, and
 * what is waiting for them to.
 *
 * The state is the files — the documents and the record beside them — and the
 * server reads it (specApproval.ts) rather than keeping one, so this is sent
 * when a tab opens and again whenever what it says would be different. The
 * window opens the document that is waiting; the bar over it, and how far the
 * tasks have got, are read from the same message.
 */
export interface SpecInfo {
	/** The spec's folder under .octave/specs/. */
	name: string;
	/**
	 * Whether this workspace started the spec, or found it on the disk because
	 * a workspace is made from the base and a spec's documents are committed
	 * like anything else (specOrigin.ts). What the window says of itself — the
	 * spec it names, the document it opens by itself — is the work here, which
	 * is the work a pull request from this branch would carry; the rest is
	 * another branch's, and still opens from the files like any other note.
	 * True for every spec where git cannot say.
	 */
	own: boolean;
	/** How many of SPEC_DOCS, from the first, are approved as the files are now. */
	approved: number;
	/** The document written and waiting for the person, or null when none is. */
	waiting: SpecDoc | null;
	/** When that document was last written, so a window can tell the newest of several. Null with nothing waiting. */
	waitingAt: number | null;
	/**
	 * Which of the documents are on the disk at all, in SPEC_DOCS order.
	 *
	 * `approved` and `waiting` cannot answer this: the reading stops at the
	 * first document that is not approved, so a spec whose three documents
	 * were all approved and whose requirements were then changed reads as
	 * `approved: 0, waiting: "requirements.md"` while the design and the tasks
	 * are still there. A window offering the documents has to tell the one
	 * that is merely later from the one that was never written — opening the
	 * second would put a spec document in front of the person that the agent
	 * has not written yet.
	 */
	written: SpecDoc[];
	/**
	 * How far the tasks have got, read off tasks.md (specTasks.ts): how many
	 * tasks there are to run, how many are done, and the number of the next.
	 * Null while there is no tasks.md. Told here rather than counted in the
	 * window because a window that is not reading tasks.md — the tab row, a
	 * spec's menu — still says it, and one parser reads the file for everybody.
	 */
	tasks: Progress | null;
	/**
	 * What each task that has been run came to: its commit, what that changed
	 * and how the run said it checked it — oldest first, the order the work
	 * was done in, and a task run twice is here twice. Read off the
	 * repository's history (specResults.ts), where a task's commit says whose
	 * it is; nothing about a result is kept anywhere else. Empty until a task
	 * has been run, and in a folder that is no repository.
	 */
	results: TaskResult[];
	/**
	 * The runs waiting to be looked at — a task each, its newest run, that no
	 * commit has accepted yet (specRuns.ts): the sessions' word against the
	 * commits'. What "in review" means, for the list and the tab row alike.
	 * Oldest first. Empty until a task has been run.
	 */
	review: TaskRun[];
}

/** Where the folder's branch stands, as git knows it — see standing.ts. */
export interface GitStanding {
	branch: string;
	/** The remote's default branch, `main`, or null with no remote. */
	base: string | null;
	/** Files changed and not committed, the app's own folder left out. */
	changes: number;
	/** Commits here that the base does not have; null with no base. */
	ahead: number | null;
	/** Commits on the base that this branch does not have; null with no base. */
	behind: number | null;
	/**
	 * The same two counts against origin's branch of this name: what a push
	 * would send, and what a pull would bring. Null where origin has no such
	 * branch — it has never been pushed — or there is no origin at all.
	 */
	remote: { ahead: number; behind: number } | null;
}

/** Sent on connecting, at a turn's end, after a task's commit, and when asked (ask_standing). Null where the folder is no repository or is on no branch. */
export interface StandingMsg {
	type: "standing";
	standing: GitStanding | null;
}

export interface SpecsMsg {
	type: "specs";
	specs: SpecInfo[];
}

/**
 * How much of a note was written by somebody other than the person reading it,
 * in characters of the text on disk.
 *
 * A summary, and only a summary. Who wrote which run is asked for (`who_wrote`)
 * because it is a question somebody puts and an answer that followed every
 * keystroke would be a different feature; a share is one number, is worked out
 * from the same reading of the log that the note itself needs, and rides along
 * with it. `other` is a write from outside the app — vim, a sync client — and
 * is kept apart from pi's, since a note that is a quarter somebody else's and
 * one that is a quarter pi's are not the same note.
 *
 * As the log last read the disk: it is the note that was written, not the note
 * being typed. What the person is typing now is their own by definition and
 * moves the share the moment it is saved.
 */
export interface Authored {
	pi: number;
	other: number;
	total: number;
}

/**
 * The notes that link to `path`, again: sent for every note whose backlinks
 * may have changed after a write, a rename or a delete anywhere. A tab with
 * the note open shows the list; the rest let it pass.
 */
export interface BacklinksMsg {
	type: "backlinks";
	path: string;
	notes: Backlink[];
}

/** The property types chosen for the vault, whole: on connect, and again whenever one is chosen. See propertyTypes.ts. */
export interface PropertyTypesMsg {
	type: "property_types";
	types: Registry;
}

/**
 * What the vault's notes call their properties and what they put in them,
 * whole: on connect, and again whenever a write changes what is on offer.
 * What the panel's boxes suggest — see propertyIndex.ts.
 */
export interface PropertyNamesMsg extends Suggestions {
	type: "property_names";
}

/** The notes sharing a tag with `path`, again: sent the same way, whenever a note's tags changed. */
export interface TaggedMsg {
	type: "tagged";
	path: string;
	notes: Tagged[];
}

/**
 * A write to a note, as the change it made. Sent to every tab after every
 * write through the app — the editor's, pi's — the way a language server
 * sends incremental edits: `changes` turn the version `base` into the version
 * `modified`, each in the text as it is when applied. A tab on `base` applies
 * them where they fall; one that is not asks for the note whole.
 */
export interface NoteChangedMsg {
	type: "note_changed";
	path: string;
	base: number;
	modified: number;
	/** As on `note`: the log's length after this change. */
	lines: number;
	changes: Change[];
	/** How much of it somebody other than you wrote, now that it has changed. See Authored. */
	authored: Authored;
	/** As on `note`: what is left to decide about, after this change. */
	original?: string;
}

/** The note new_note made, for the tab that asked to open it. */
export interface NoteCreatedMsg {
	type: "note_created";
	path: string;
}

/** A note moved. A tab with `from` open is now looking at `to`; nothing in the text changed. */
export interface NoteRenamedMsg {
	type: "note_renamed";
	from: string;
	to: string;
}

export interface NoteRenameFailedMsg {
	type: "note_rename_failed";
	path: string;
	to: string;
	reason: "invalid" | "missing" | "exists";
}

/**
 * A run of the note with one author, in the note as it is on disk.
 *
 * `at` is when it was written; `session` is the conversation pi wrote it in,
 * for the ones pi wrote. What the person wrote themselves is left out — most
 * of a note is theirs, and a note marked all over says nothing.
 */
export interface AuthoredSpan {
	from: number;
	to: number;
	author: Author;
	at: number;
	session?: string;
}

/** Who wrote which words, as asked for by `who_wrote`. */
export interface AuthorsMsg {
	type: "authors";
	path: string;
	spans: AuthoredSpan[];
}

/**
 * One run of the note, and everything there is to say about how it got there.
 *
 * `removed` and `model` and `prompt` are each there when they are known. What
 * stood before is kept only while the run is still the whole of what its
 * change wrote; the model and the question come from pi's own record of the
 * conversation, which a person may have deleted since.
 */
export interface WhyMsg {
	type: "why";
	path: string;
	from: number;
	to: number;
	author: Author;
	at: number;
	/** The words as they are now. */
	text: string;
	/**
	 * What they replaced. Empty when they replaced nothing, which is what a run
	 * pi only added looks like; absent when the run is no longer the whole of
	 * what its change wrote and what it replaced is not known any more.
	 */
	removed?: string;
	/** For pi: `provider/model` it was on. */
	model?: string;
	/** For pi: the message the turn began with. */
	prompt?: string;
	/** For pi: the conversation and the turn, so it can be taken there. */
	session?: string;
	entry?: string;
}

/**
 * A note went to the trash, by someone's choice.
 *
 * `to` says which trash, and the two are undone in different places. The
 * machine's is the one the person already has — the Finder opens it, Put Back
 * brings a note home, and nothing here can reach in after it. The vault's own
 * `.pi/trash/` is where a note goes when this run has no shell to ask, and
 * `trashed` is the name it took there, which restore_note needs.
 *
 * A tab with the note open closes it, and offers to bring it back only where
 * there is a way to from here.
 */
export type NoteDeletedMsg =
	| { type: "note_deleted"; path: string; to: "system" }
	| { type: "note_deleted"; path: string; to: "vault"; trashed: string };

/**
 * The note is not on disk. Sent to every tab when the watcher sees it go, and
 * to a tab that asks to open or save one that is gone. A tab with it open
 * decides: put it back from what it shows, or close it.
 */
export interface NoteGoneMsg {
	type: "note_gone";
	path: string;
}

/**
 * A file of the repository as text, to be read and not written — what a code
 * tab shows (pages.ts). The answer to open_code, and what the tab reading it
 * is sent again whenever the file changes on disk.
 *
 * Not a note's message and not a spec's: there is no log to say a change
 * against, no links, no version to save over. `modified` is here so a tab can
 * tell a file it has from the same file written since, and for nothing else.
 */
/** A commit and each file it changed, before and after — the answer to open_commit. See commitRead.ts. */
export interface CommitMsg extends CommitRead {
	type: "commit";
	/** What was asked for, as it was asked: a short hash is answered with the whole one, and the tab that asked knows itself by this. */
	asked: string;
}

/** The answer to ask_work: the files changed and not committed, and the commits a push would send, newest first. Empty in no repository. */
export interface WorkMsg {
	type: "work";
	files: WorkingEntry[];
	/** More files are changed than are listed. */
	truncated: boolean;
	commits: Outgoing[];
}

/** The answer to open_changes: each file changed and not committed, before and after. Empty in no repository. */
export interface ChangesMsg {
	type: "changes";
	files: CommitFile[];
	/** More files are changed than are given. */
	truncated: boolean;
}

/** There is no such commit in this repository, or what was asked for is not a commit's name. */
export interface CommitGoneMsg {
	type: "commit_gone";
	asked: string;
}

/** A task's run — what it said and what it changed — the answer to open_task. See taskRead.ts. */
export interface TaskMsg extends TaskRead {
	type: "task";
}

/** The task has not been run here: no session ran it and no commit is its. */
export interface TaskGoneMsg {
	type: "task_gone";
	spec: string;
	task: string;
}

export interface CodeMsg {
	type: "code";
	path: string;
	text: string;
	modified: number;
	/** The file is longer than a tab will read, and `text` is its first part — its last, for a log under `.pi/runs/` (vault.ts's CODE_MAX). */
	truncated: boolean;
}

/**
 * There is nothing to show: no such file, or one that is not text — a
 * picture, a binary — which is said rather than drawn as the bytes it is.
 */
export interface CodeGoneMsg {
	type: "code_gone";
	path: string;
	reason: "missing" | "binary";
}

/** The save was refused: the note changed since `base`. `modified` is what is there now. */
export interface NoteConflictMsg {
	type: "note_conflict";
	path: string;
	modified: number;
}

/** The lines that say what search_notes asked for, in the notes' list order. See search.ts. */
/** The notes a run's undo put back — none, when there was nothing left to decide in any of them. */
export interface RunUndoneMsg {
	type: "run_undone";
	notes: string[];
}

export interface SearchResultsMsg {
	type: "search_results";
	id: number;
	query: string;
	hits: SearchHit[];
}

export type PromptType = "select" | "input" | "confirm" | "editor" | "multiselect" | "batch";

/**
 * A question an extension asked, forwarded by the server (see prompts.ts).
 * Not an Item: it never goes through conversation.js.
 */
export interface PromptRequest {
	id: string;
	pipeline: string;
	type: PromptType;
	question: string;
	options?: string[];
	defaultValue?: string;
	/** `message` for explanatory text; `questions` for a batch; `toolCallId` if the extension set it. */
	metadata?: Record<string, unknown>;
}

export interface PromptRequestMsg {
	type: "prompt_request";
	prompt: PromptRequest;
}

/** The question is settled — by this tab, another tab, or the extension's timeout. */
export interface PromptDismissMsg {
	type: "prompt_dismiss";
	id: string;
	answer?: string;
	cancelled: boolean;
}

/**
 * How the ask `id` ended, to the tab that asked. The answer itself is not here:
 * it went into the note, so it arrives as `note_changed` like any other write.
 */
export interface AskDoneMsg {
	type: "ask_done";
	id: number;
	outcome: AskOutcome;
}

/** The messages a clear took out of the queue, returned so they can go back in the box. */
export interface QueueClearedMsg {
	type: "queue_cleared";
	steering: string[];
	followUp: string[];
}

/** Something an extension wanted said, drawn in the conversation as a notice. */
export interface NoticeMsg {
	type: "notice";
	text: string;
}

/** Something the server could not do, said to the one tab that asked. */
export interface ErrorMsg {
	type: "error";
	message: string;
}

/**
 * Everything else is a pi session event, passed through as it came (see
 * toWireEvent in server.ts) and folded in by conversation.js. Left open the
 * way pi's own JsonAgentSessionEvent is: the reducer, not this file, is what
 * knows their shapes.
 */
export interface PiEventMsg {
	type: string;
	[key: string]: unknown;
}

/**
 * The messages this server makes up, as opposed to passes through. Named apart
 * from the union below because PiEventMsg's open `type` would otherwise match
 * every one of these and a `switch` could narrow none of them: a receiver
 * first tells a state message from an event, then switches over this.
 */
export type StateMsg =
	| ConfigMsg
	| ProvidersMsg
	| SettingsMsg
	| LoginPromptMsg
	| LoginPromptDismissMsg
	| LoginEventMsg
	| LoginDoneMsg
	| UsageMsg
	| ContextSourcesMsg
	| CommandsMsg
	| NoticeMsg
	| BranchesMsg
	| SessionsMsg
	| SnapshotMsg
	| FilesMsg
	| RepoMsg
	| NoteMsg
	| SpecMsg
	| SpecsMsg
	| StandingMsg
	| BacklinksMsg
	| TaggedMsg
	| PropertyTypesMsg
	| PropertyNamesMsg
	| NoteChangedMsg
	| NoteCreatedMsg
	| NoteRenamedMsg
	| NoteRenameFailedMsg
	| NoteGoneMsg
	| CodeMsg
	| CommitMsg
	| CommitGoneMsg
	| TaskMsg
	| TaskGoneMsg
	| WorkMsg
	| ChangesMsg
	| CodeGoneMsg
	| NoteDeletedMsg
	| NoteConflictMsg
	| AuthorsMsg
	| WhyMsg
	| SearchResultsMsg
	| RunUndoneMsg
	| AskDoneMsg
	| PromptRequestMsg
	| PromptDismissMsg
	| QueueClearedMsg
	| ErrorMsg;

export type ServerMsg = StateMsg | PiEventMsg;
