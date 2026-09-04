const chat = document.getElementById("chat");
const raw = document.getElementById("raw");
const status = document.getElementById("status");
const form = document.getElementById("form");
const text = document.getElementById("text");
const rawToggle = document.getElementById("rawToggle");

/** Every event, unmodified. The only way to debug when the chat view is wrong. */
const events = [];
/** Rendered conversation items, built from the event stream. */
const items = [];
/** The assistant item currently receiving text_delta, if any. */
let openText = null;
/** tool_execution_start items awaiting their _end, keyed by toolCallId. */
const openTools = new Map();

rawToggle.addEventListener("change", () => {
	document.body.classList.toggle("raw", rawToggle.checked);
});

function textOf(message) {
	return (message?.content ?? [])
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function resultText(result) {
	if (typeof result === "string") return result;
	const parts = result?.content;
	if (Array.isArray(parts)) {
		return parts.filter((p) => p.type === "text").map((p) => p.text).join("");
	}
	return JSON.stringify(result);
}

/** Provider errors arrive as "400 {json}". Show the human sentence, keep the rest in raw view. */
function errorText(message) {
	const json = message.slice(message.indexOf("{"));
	try {
		return JSON.parse(json).error?.message ?? message;
	} catch {
		return message;
	}
}

function apply(event) {
	switch (event.type) {
		case "agent_start":
			status.textContent = "working…";
			break;

		case "message_start":
			if (event.message?.role === "user") items.push({ kind: "user", text: textOf(event.message) });
			break;

		case "message_update": {
			const sub = event.assistantMessageEvent;
			if (sub.type === "text_start") {
				openText = { kind: "assistant", text: "" };
				items.push(openText);
			} else if (sub.type === "text_delta") {
				if (!openText) {
					openText = { kind: "assistant", text: "" };
					items.push(openText);
				}
				openText.text += sub.delta;
			} else if (sub.type === "text_end") {
				openText = null;
			}
			break;
		}

		case "message_end":
			// Provider failures arrive here, not as a thrown error on the server.
			if (event.message?.stopReason === "error") {
				items.push({ kind: "error", text: errorText(event.message.errorMessage ?? "unknown error") });
			} else if (event.message?.role === "assistant" && !openText && textOf(event.message)) {
				// Non-streaming reply: no text_delta ever arrived.
				const already = items.some((i) => i.kind === "assistant" && i.text === textOf(event.message));
				if (!already) items.push({ kind: "assistant", text: textOf(event.message) });
			}
			openText = null;
			break;

		case "tool_execution_start": {
			const item = { kind: "tool", name: event.toolName, args: event.args, result: null, isError: false };
			openTools.set(event.toolCallId, item);
			items.push(item);
			break;
		}

		case "tool_execution_end": {
			const item = openTools.get(event.toolCallId);
			if (item) {
				item.result = resultText(event.result);
				item.isError = event.isError;
				openTools.delete(event.toolCallId);
			}
			break;
		}

		case "agent_settled":
			status.textContent = "idle";
			items.push({ kind: "done" });
			break;

		case "error":
			items.push({ kind: "error", text: event.message });
			break;
	}
}

function el(tag, className, textContent) {
	const node = document.createElement(tag);
	node.className = className;
	if (textContent !== undefined) node.textContent = textContent;
	return node;
}

function renderItem(item) {
	if (item.kind === "tool") {
		const node = el("div", "item tool");
		node.append(el("span", "name", item.name), ` ${JSON.stringify(item.args)}`);
		if (item.result !== null) {
			const pre = el("pre", item.isError ? "error" : "", item.result);
			node.append(pre);
		}
		return node;
	}
	const label = { user: "user", assistant: "assistant", error: "error", done: "done" }[item.kind];
	return el("div", `item ${label}`, item.kind === "done" ? "— 완료 —" : item.text);
}

function render() {
	const atBottom = chat.parentElement.scrollHeight - chat.parentElement.scrollTop - chat.parentElement.clientHeight < 40;
	chat.replaceChildren(...items.map(renderItem));
	raw.textContent = events.map((e) => JSON.stringify(e, null, 2)).join("\n");
	if (atBottom) chat.parentElement.scrollTop = chat.parentElement.scrollHeight;
}

const ws = new WebSocket(`ws://${location.host}`);
ws.onopen = () => (status.textContent = "idle");
ws.onclose = () => (status.textContent = "disconnected");
ws.onmessage = (e) => {
	const event = JSON.parse(e.data);
	events.push(event);
	apply(event);
	render();
};

form.addEventListener("submit", (e) => {
	e.preventDefault();
	const value = text.value.trim();
	if (!value || ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify({ type: "prompt", text: value }));
	text.value = "";
});
