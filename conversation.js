/**
 * How a pi session becomes a conversation.
 *
 * Two paths produce items: the live event stream (applyEvent) and a resumed
 * session's stored messages (itemsFromMessages). They have to agree, or a
 * conversation looks different after resuming than it did live. They live here
 * together, imported by both the browser client and the server, so the
 * agreement can be tested.
 *
 * @typedef {object} Item
 * @property {"user"|"assistant"|"tool"|"error"|"done"|"notice"} kind
 * @property {string} [text]
 * @property {string} [name]     tool name
 * @property {unknown} [args]    tool arguments
 * @property {string|null} [result]
 * @property {boolean} [isError]
 */

/** Concatenate the text parts of a message content array. */
export function textOf(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("");
}

/**
 * Tool results arrive as `{content:[...]}` live and as a toolResult message on
 * resume; both carry the same array. Anything else is shown as JSON rather than
 * dropped, so an unexpected shape is visible instead of silently blank.
 */
export function resultText(result) {
	if (typeof result === "string") return result;
	if (Array.isArray(result?.content)) return textOf(result.content);
	return JSON.stringify(result);
}

/** Provider errors arrive as `400 {json}`. Show the sentence, not the envelope. */
export function errorText(message) {
	const brace = message.indexOf("{");
	if (brace === -1) return message;
	try {
		return JSON.parse(message.slice(brace)).error?.message ?? message;
	} catch {
		return message;
	}
}

/**
 * What a finished compaction says. Live it comes from compaction_end's result;
 * on resume, from the compactionSummary message the compaction left behind.
 * Both call this so the two paths word it the same.
 */
export function compactionText(tokensBefore) {
	if (typeof tokensBefore !== "number") return "Compacted the conversation";
	return `Compacted the conversation (${tokensBefore} tokens before)`;
}

const COMPACTION_REASON = {
	manual: "manual",
	threshold: "context limit reached",
	overflow: "context overflow",
};

export function createConversation() {
	return {
		/** @type {Item[]} */
		items: [],
		status: "idle",
		/** The assistant item currently receiving text_delta, if any. */
		openText: null,
		/** tool_execution_start items awaiting their _end, keyed by toolCallId. */
		openTools: new Map(),
		/** Whether the assistant message in flight has streamed any text. */
		sawText: false,
		/** The notice tracking an auto-retry in progress, if any. */
		openRetry: null,
		/** The notice tracking a compaction in progress, if any. */
		openCompaction: null,
	};
}

/**
 * Fold one session event into the conversation.
 *
 * Returns the items that were appended and the ones whose contents changed, so
 * a renderer can touch only those. Callers that re-render wholesale can ignore
 * the return value and read `state.items`.
 *
 * @returns {{added: Item[], changed: Item[]}}
 */
export function applyEvent(state, event) {
	const added = [];
	const changed = [];
	const add = (item) => {
		state.items.push(item);
		added.push(item);
		return item;
	};

	/**
	 * Notices track something in progress, so the same item is reworded as it
	 * proceeds rather than a new one appended per step. Keeps one event to at
	 * most one touched item, which is what lets a renderer stay incremental.
	 */
	const notice = (open, text) => {
		if (!open) return add({ kind: "notice", text });
		open.text = text;
		changed.push(open);
		return open;
	};

	switch (event.type) {
		case "agent_start":
			state.status = "working";
			break;

		case "message_start":
			if (event.message?.role === "user") {
				const text = textOf(event.message.content);
				if (text) add({ kind: "user", text });
			} else if (event.message?.role === "assistant") {
				state.sawText = false;
			}
			break;

		case "message_update": {
			const sub = event.assistantMessageEvent;
			if (sub.type === "text_start") {
				state.openText = add({ kind: "assistant", text: "" });
				state.sawText = true;
			} else if (sub.type === "text_delta") {
				if (!state.openText) state.openText = add({ kind: "assistant", text: "" });
				state.sawText = true;
				state.openText.text += sub.delta;
				changed.push(state.openText);
			} else if (sub.type === "text_end") {
				state.openText = null;
			}
			break;
		}

		case "message_end":
			// Provider failures arrive here rather than as a thrown error.
			if (event.message?.stopReason === "error") {
				add({ kind: "error", text: errorText(event.message.errorMessage ?? "unknown error") });
			} else if (event.message?.role === "assistant" && !state.sawText) {
				// Nothing streamed for this message, so take the finished text.
				const text = textOf(event.message.content);
				if (text) add({ kind: "assistant", text });
			}
			state.openText = null;
			break;

		case "tool_execution_start":
			state.openTools.set(
				event.toolCallId,
				add({ kind: "tool", name: event.toolName, args: event.args, result: null, isError: false }),
			);
			break;

		case "tool_execution_update": {
			// Partial output is a cumulative snapshot, so it overwrites rather
			// than appends, and tool_execution_end overwrites it in turn. The
			// first update of a run carries no content yet; showing it would
			// open an empty result pane for the rest of the run.
			const item = state.openTools.get(event.toolCallId);
			const text = resultText(event.partialResult);
			if (item && text) {
				item.result = text;
				changed.push(item);
			}
			break;
		}

		case "tool_execution_end": {
			const item = state.openTools.get(event.toolCallId);
			if (item) {
				item.result = resultText(event.result);
				item.isError = event.isError;
				changed.push(item);
				state.openTools.delete(event.toolCallId);
			}
			break;
		}

		// pi retries retryable provider failures itself, with exponential
		// backoff. Without this the UI sits silent for the whole wait — with
		// the default three retries at 2s, that is 14 seconds of nothing after
		// an error line. _start fires once per attempt and _end only once at
		// the finish, so every attempt rewords the one notice.
		//
		// A retry leaves no trace in the stored session, so this notice is
		// live-only, like `done`. A recording that contains a retry could not
		// be compared against itemsFromMessages without filtering it out.
		case "auto_retry_start":
			state.openRetry = notice(
				state.openRetry,
				`Retry ${event.attempt}/${event.maxAttempts} — in ${Math.round(event.delayMs / 100) / 10}s`,
			);
			break;

		case "auto_retry_end":
			if (state.openRetry) {
				notice(
					state.openRetry,
					event.success
						? `Retry succeeded (attempt ${event.attempt})`
						: `Retry failed (attempt ${event.attempt})${event.finalError ? ` — ${errorText(event.finalError)}` : ""}`,
				);
				state.openRetry = null;
			}
			break;

		// Compaction rewrites the conversation's history without being asked.
		// Unannounced, the context percentage simply drops and earlier messages
		// stop mattering, with nothing on screen to say why.
		case "compaction_start":
			state.openCompaction = notice(
				state.openCompaction,
				`Compacting the conversation (${COMPACTION_REASON[event.reason] ?? event.reason})`,
			);
			break;

		case "compaction_end":
			if (state.openCompaction) {
				let text;
				if (event.aborted) text = "Compaction was aborted";
				else if (event.errorMessage)
					text = `Compaction failed — ${errorText(event.errorMessage)}${event.willRetry ? ", retrying" : ""}`;
				else text = compactionText(event.result?.tokensBefore);
				notice(state.openCompaction, text);
				state.openCompaction = null;
			}
			break;

		case "agent_settled":
			state.status = "idle";
			add({ kind: "done" });
			break;

		case "error":
			add({ kind: "error", text: errorText(event.message) });
			break;
	}

	return { added, changed };
}

/**
 * The same conversation, rebuilt from a session's stored messages.
 *
 * A resumed session emits no events for the history it already has, so this is
 * the only way to show it. `agent_settled` has no counterpart in stored
 * messages, so no `done` items are produced.
 *
 * @returns {Item[]}
 */
export function itemsFromMessages(messages) {
	/** @type {Item[]} */
	const items = [];
	const toolItems = new Map();

	for (const message of messages) {
		if (message.role === "user") {
			const text = textOf(message.content);
			if (text) items.push({ kind: "user", text });
		} else if (message.role === "assistant") {
			// Live, an assistant message's text streams before any of its tool
			// calls start, so replay in that order rather than in content order.
			for (const part of message.content) {
				if (part.type === "text" && part.text) items.push({ kind: "assistant", text: part.text });
			}
			for (const part of message.content) {
				if (part.type === "toolCall") {
					const item = { kind: "tool", name: part.name, args: part.arguments, result: null, isError: false };
					toolItems.set(part.id, item);
					items.push(item);
				}
			}
			// errorMessage is optional, so a failed message with none still has
			// to surface — the live path shows it, and pi's own UI does too.
			if (message.stopReason === "error") {
				items.push({ kind: "error", text: errorText(message.errorMessage ?? "unknown error") });
			}
		} else if (message.role === "compactionSummary") {
			// Left behind by a compaction, in place of the messages it replaced.
			items.push({ kind: "notice", text: compactionText(message.tokensBefore) });
		} else if (message.role === "toolResult") {
			const item = toolItems.get(message.toolCallId);
			if (item) {
				item.result = resultText(message);
				item.isError = message.isError;
			}
		}
	}
	return items;
}
