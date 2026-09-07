/** Mirrors the Item typedef in conversation.js, which is plain JS with JSDoc. */
export interface Item {
	kind: "user" | "assistant" | "tool" | "error" | "done" | "notice";
	text?: string;
	name?: string;
	args?: unknown;
	result?: string | null;
	isError?: boolean;
	/** ms, on `done`: when the run's first message was written, and its last. */
	startedAt?: number;
	endedAt?: number;
	/** On `done`: why the run's last message stopped, and what the run billed. */
	stopReason?: string;
	tokens?: number;
	cost?: number;
	/** On `done`: what the run said, carried so the footer can offer to copy it. */
	answer?: string;
	/**
	 * Whether a tool is still running. Projected by the store from the reducer's
	 * openTools; conversation.js has no such field. It is needed because a tool
	 * writes partial output into `result` while it runs, so `result !== null`
	 * does not mean finished.
	 */
	pending?: boolean;
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
	context: { tokens: number | null; window: number; percent: number } | null;
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

/** The messages a clear took out of the queue, returned so they can go back in the box. */
export interface QueueClearedMsg {
	type: "queue_cleared";
	steering: string[];
	followUp: string[];
}

/** The question is settled — by this tab, another tab, or the extension's timeout. */
export interface PromptDismissMsg {
	type: "prompt_dismiss";
	id: string;
	answer?: string;
	cancelled: boolean;
}

export type ServerMsg =
	| ConfigMsg
	| UsageMsg
	| ContextSourcesMsg
	| PromptRequestMsg
	| PromptDismissMsg
	| QueueClearedMsg
	| { type: "sessions"; sessions: SessionInfo[] }
	| { type: "snapshot"; items: Item[] }
	// Everything else is a raw pi session event, folded in by conversation.js.
	| { type: string; [key: string]: unknown };
