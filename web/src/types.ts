/** Mirrors the Item typedef in conversation.js, which is plain JS with JSDoc. */
export interface Item {
	kind: "user" | "assistant" | "tool" | "error" | "done" | "notice";
	text?: string;
	name?: string;
	args?: unknown;
	result?: string | null;
	isError?: boolean;
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

export type ServerMsg =
	| ConfigMsg
	| UsageMsg
	| { type: "sessions"; sessions: SessionInfo[] }
	| { type: "snapshot"; items: Item[] }
	// Everything else is a raw pi session event, folded in by conversation.js.
	| { type: string; [key: string]: unknown };
