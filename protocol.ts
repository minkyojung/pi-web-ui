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
import type { BranchPoint } from "./branches";
import type { NoteFile } from "./files";

export type { BranchPoint, NoteFile };

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
	| { type: "set_session_name"; name: string };

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

/** The notes in the working folder. See files.ts. */
export interface FilesMsg {
	type: "files";
	files: NoteFile[];
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

export type ServerMsg =
	| ConfigMsg
	| UsageMsg
	| ContextSourcesMsg
	| BranchesMsg
	| SessionsMsg
	| SnapshotMsg
	| FilesMsg
	| PromptRequestMsg
	| PromptDismissMsg
	| QueueClearedMsg
	| ErrorMsg
	| PiEventMsg;
