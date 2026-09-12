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
import type { Ask, AskOutcome } from "./ask";
import type { BranchPoint } from "./branches";
import type { Author, Change, Span } from "./history";
import type { NoteFile } from "./vault";
import type { Backlink, Tagged } from "./linkIndex";
import type { SearchHit } from "./search";

export type { Ask, AskOutcome, Author, Backlink, BranchPoint, Change, NoteFile, SearchHit, Span, Tagged };

// ---------------------------------------------------------------------------
// Browser → server

export type ClientMsg =
	| {
			type: "prompt";
			text: string;
			/** What to do with it mid-run. Ignored when nothing is running. */
			behavior?: "steer" | "followUp";
			/** Asking again: the user message this one is an alternative to. */
			entryId?: string;
			/** The note open in the editor, for pi to be told about this turn. Not part of the message. */
			note?: string;
			/**
			 * The words chosen in that note when this was sent, for pi to be told
			 * about this turn beside the note itself. Like `note`, not part of the
			 * message: what is chosen when a question is asked again later is
			 * whatever is chosen then, which is nothing to do with this one.
			 */
			chosen?: string;
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
	| { type: "new_session" }
	| { type: "resume_session"; path: string }
	| { type: "prompt_response"; id: string; answer?: string; cancelled?: boolean }
	| { type: "navigate"; entryId: string }
	| { type: "set_session_name"; name: string }
	/** A note to look at. Answered with `note`, or `note_gone` if there is no such note. */
	| { type: "open_note"; path: string }
	/**
	 * A note's whole text, on top of the version it was read at — `base` is
	 * that version's `modified`, or null for a note that did not exist yet.
	 * Answered with `note` to every tab, or `note_conflict` to this one.
	 */
	| { type: "save_note"; path: string; text: string; base: number | null }
	/** The words at [from, to) are fine as they are. Answered with `note` to every tab. */
	| { type: "accept_note"; path: string; from: number; to: number }
	/**
	 * A new, empty note. Named by the server unless `name` is given — a title,
	 * as the title field takes one — and refused with `note_rename_failed` if
	 * that name is taken or not a note's. Answered with `note_created` to this
	 * tab and `note` to every tab.
	 */
	| { type: "new_note"; name?: string }
	/** Give a note another path. Answered with `note_renamed` to every tab, or `note_rename_failed` to this one. */
	| { type: "rename_note"; path: string; to: string }
	/** Put a note in the trash. Answered with `note_deleted` to every tab. */
	| { type: "delete_note"; path: string }
	/** Bring a trashed note back to its path. Answered with `note_created` to this tab and `note` to every tab. */
	| { type: "restore_note"; trashed: string; path: string }
	/**
	 * Every note's text, for `query`. Answered with `search_results` to this
	 * tab; `id` is the tab's own count of asks, sent back so an answer that
	 * arrives after a newer ask can be told apart and dropped.
	 */
	| { type: "search_notes"; query: string; id: number };

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

export interface ConfigMsg {
	type: "config";
	model: string | null;
	models: string[];
	thinkingLevel: string;
	thinkingLevels: string[];
	tools: { name: string; description?: string }[];
	activeTools: string[];
	isStreaming: boolean;
	queued: { steering: string[]; followUp: string[] };
	sessionId: string;
	sessionName: string | null;
}

export interface UsageMsg {
	type: "usage";
	cost: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	messages: number;
	toolCalls: number;
	/** `percent` is null when pi has no count yet; the gauge draws "unknown" for it. */
	context: { tokens: number | null; window: number; percent: number | null } | null;
}

/** Sizes of what fills the context besides the conversation. See contextBreakdown.ts. */
export interface ContextSourcesMsg {
	type: "context_sources";
	systemPromptChars: number;
	tools: { name: string; chars: number; active: boolean }[];
	skills: number;
	memoryFiles: { count: number; chars: number };
	login: { oauth: boolean; subscription: boolean };
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

/** The notes in the working folder. See vault.ts. */
export interface FilesMsg {
	type: "files";
	files: NoteFile[];
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
	spans: Span[];
	/** The notes that link to this one, from the index. */
	backlinks: Backlink[];
	/** The notes that share a tag with this one, from the index. */
	tagged: Tagged[];
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
	changes: Change[];
	spans: Span[];
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
 * A note went to the trash, by someone's choice. `trashed` is its name there,
 * which restore_note needs; a tab with the note open closes it and may offer
 * to bring it back.
 */
export interface NoteDeletedMsg {
	type: "note_deleted";
	path: string;
	trashed: string;
}

/**
 * The note is not on disk. Sent to every tab when the watcher sees it go, and
 * to a tab that asks to open or save one that is gone. A tab with it open
 * decides: put it back from what it shows, or close it.
 */
export interface NoteGoneMsg {
	type: "note_gone";
	path: string;
}

/** The save was refused: the note changed since `base`. `modified` is what is there now. */
export interface NoteConflictMsg {
	type: "note_conflict";
	path: string;
	modified: number;
}

/** The lines that say what search_notes asked for, in the notes' list order. See search.ts. */
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
	| UsageMsg
	| ContextSourcesMsg
	| BranchesMsg
	| SessionsMsg
	| SnapshotMsg
	| FilesMsg
	| NoteMsg
	| BacklinksMsg
	| TaggedMsg
	| NoteChangedMsg
	| NoteCreatedMsg
	| NoteRenamedMsg
	| NoteRenameFailedMsg
	| NoteGoneMsg
	| NoteDeletedMsg
	| NoteConflictMsg
	| SearchResultsMsg
	| AskDoneMsg
	| PromptRequestMsg
	| PromptDismissMsg
	| QueueClearedMsg
	| ErrorMsg;

export type ServerMsg = StateMsg | PiEventMsg;
