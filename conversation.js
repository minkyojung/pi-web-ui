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
 * @property {"user"|"assistant"|"tool"|"error"|"done"} kind
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
