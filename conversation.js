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
 * @property {"user"|"assistant"|"thinking"|"tool"|"error"|"done"|"notice"} kind
 * @property {string} [text]
 * @property {string} [name]     tool name
 * @property {unknown} [args]    tool arguments
 * @property {string|null} [result]
 * @property {boolean} [isError]
 * @property {number} [startedAt]  ms, on `done`: when the run's first message was written
 * @property {number} [endedAt]    ms, on `done`: when its last one was
 * @property {string} [stopReason] on `done`: why the run's last message stopped
 * @property {number} [tokens]     on `done`: tokens the run billed, across its messages
 * @property {number} [cost]       on `done`: what it cost, in dollars
 * @property {string} [answer]     on `done`: what the run said, for copying
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

/**
 * The running total a `done` is made of.
 *
 * Both paths keep one — the live stream while a run is in flight, and the
 * resumed reader between one user message and the next — so it is defined once
 * here, along with what it turns into, or the two would drift.
 */
function newRun() {
	return {
		runStartedAt: null,
		runEndedAt: null,
		runTokens: 0,
		runCost: 0,
		runStopReason: null,
	};
}

function doneItem(run, answer) {
	return {
		kind: "done",
		startedAt: run.runStartedAt,
		endedAt: run.runEndedAt,
		stopReason: run.runStopReason,
		// Zero is nothing to say rather than a fact about the run: a provider
		// that reports no usage should read the same as silence.
		tokens: run.runTokens || null,
		cost: run.runCost || null,
		// Its own field rather than `text`, which everywhere else in this type
		// means the thing on screen. A `done` shows figures; the answer rides
		// along only so it can be copied.
		answer,
	};
}

/** Widen the run's span to include a message, if it came with a time. */
function stamp(state, message) {
	const at = message?.timestamp;
	if (typeof at !== "number") return;
	if (state.runStartedAt === null || at < state.runStartedAt) state.runStartedAt = at;
	if (state.runEndedAt === null || at > state.runEndedAt) state.runEndedAt = at;
}

/** Add a message's usage to the run's, and take its ending as the run's so far. */
function bill(state, message) {
	if (message?.role !== "assistant") return;
	const usage = message.usage;
	if (typeof usage?.totalTokens === "number") state.runTokens += usage.totalTokens;
	if (typeof usage?.cost?.total === "number") state.runCost += usage.cost.total;
	// The last assistant message of a run is the one that says how it ended; the
	// ones before it stopped for `toolUse` on the way here.
	if (typeof message.stopReason === "string") state.runStopReason = message.stopReason;
}

/**
 * What the run said, for whoever wants to copy it.
 *
 * Read back off the items rather than accumulated as the text streams: the
 * items are already the answer, and a second copy kept alongside them is a
 * second copy to keep in step.
 */
function answerOf(items) {
	const said = [];
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i].kind === "done") break;
		if (items[i].kind === "assistant" && items[i].text) said.unshift(items[i].text);
	}
	return said.join("\n\n");
}

export function createConversation() {
	return {
		/** @type {Item[]} */
		items: [],
		status: "idle",
		/** The assistant item currently receiving text_delta, if any. */
		openText: null,
		/** The thinking item currently receiving thinking_delta, if any. */
		openThinking: null,
		/** tool_execution_start items awaiting their _end, keyed by toolCallId. */
		openTools: new Map(),
		/** Whether the assistant message in flight has streamed any text. */
		sawText: false,
		/** The notice tracking an auto-retry in progress, if any. */
		openRetry: null,
		/** The notice tracking a compaction in progress, if any. */
		openCompaction: null,
		/**
		 * When the messages of the run in flight were written, in ms.
		 *
		 * Taken from the messages themselves rather than read off a clock here:
		 * a reducer that calls Date.now() cannot be replayed, and a recording
		 * would then produce a different conversation every time it was run.
		 */
		/**
		 * What the run in flight has spent, how long it has been going, and how
		 * its last message ended. Summed across messages rather than taken from
		 * the last one: a turn that calls tools is several assistant messages,
		 * each billed, and the last of them is usually the cheapest.
		 */
		...newRun(),
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
			Object.assign(state, newRun());
			break;

		case "message_start":
			stamp(state, event.message);
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
			} else if (sub.type === "thinking_start") {
				// No item yet, unlike text_start. A provider that reasons without
				// publishing a summary — which is what an encrypted reasoning block
				// is — still opens and closes a thinking block, and one recorded
				// turn has two of them with not a single delta between. Opening on
				// the first delta instead means an empty thought is no thought,
				// which is also what the stored message says: its thinking part is
				// there with nothing in it, and itemsFromMessages skips it.
				state.openThinking = null;
			} else if (sub.type === "thinking_delta") {
				// The first delta carries the item in with it, rather than adding an
				// empty one and immediately changing it: one event has to touch at
				// most one item, which is what lets a renderer stay incremental.
				if (state.openThinking) {
					state.openThinking.text += sub.delta;
					changed.push(state.openThinking);
				} else {
					state.openThinking = add({ kind: "thinking", text: sub.delta });
				}
			} else if (sub.type === "thinking_end") {
				// The finished thought, not the deltas added up. The two are not
				// always the same string — one recorded turn ends its thinking two
				// newlines longer than the pieces it sent — and the finished one is
				// what the session file keeps, so taking it here is what makes a
				// resumed conversation read like the live one. It also covers a
				// provider that sends the whole thought only at the end.
				if (typeof sub.content === "string" && sub.content) {
					if (state.openThinking) {
						state.openThinking.text = sub.content;
						changed.push(state.openThinking);
					} else {
						add({ kind: "thinking", text: sub.content });
					}
				}
				state.openThinking = null;
			}
			break;
		}

		case "message_end":
			stamp(state, event.message);
			bill(state, event.message);
			// Provider failures arrive here rather than as a thrown error.
			if (event.message?.stopReason === "error") {
				add({ kind: "error", text: errorText(event.message.errorMessage ?? "unknown error") });
			} else if (event.message?.role === "assistant" && !state.sawText) {
				// Nothing streamed for this message, so take the finished text.
				const text = textOf(event.message.content);
				if (text) add({ kind: "assistant", text });
			}
			state.openText = null;
			state.openThinking = null;
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

		// What the run cost, how long it took, when it ended, and the answer it
		// produced — everything that is only true of a whole run, on the one
		// item that marks the end of one.
		case "agent_settled":
			state.status = "idle";
			add(doneItem(state, answerOf(state.items)));
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

	let run = newRun();
	/** Whether the run being read has anything in it to finish. */
	let running = false;

	/**
	 * Close the run being read, if there is one.
	 *
	 * A session file has no `agent_settled` in it, so a run is bounded by the
	 * user messages around it. That is one boundary too many for a run that was
	 * steered — pi injects a steering message into a run in flight, and this
	 * reads it as the start of the next one — but the alternative is a session
	 * with no times, no cost, and no sign of an answer that stopped early, which
	 * is the half of it that matters. An extra rule in a steered conversation is
	 * a smaller lie than a truncated answer that looks finished.
	 */
	const settle = () => {
		if (running) items.push(doneItem(run, answerOf(items)));
		run = newRun();
		running = false;
	};

	for (const message of messages) {
		if (message.role === "user") {
			settle();
			stamp(run, message);
			const text = textOf(message.content);
			if (text) items.push({ kind: "user", text });
		} else if (message.role === "assistant") {
			// Live, the same two numbers come off message_start and message_end,
			// and a tool result is not a message there — so it is not one here.
			stamp(run, message);
			bill(run, message);
			running = true;
			// Live, a message thinks before it speaks and speaks before its tool
			// calls start, so replay in that order rather than in content order.
			for (const part of message.content) {
				// Redacted thinking is an opaque payload the provider keeps for its
				// own continuity, with nothing in it to read.
				if (part.type === "thinking" && part.thinking && !part.redacted) {
					items.push({ kind: "thinking", text: part.thinking });
				}
			}
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
	settle();
	return items;
}
