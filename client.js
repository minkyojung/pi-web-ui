const chat = document.getElementById("chat");
const raw = document.getElementById("raw");
const status = document.getElementById("status");
const form = document.getElementById("form");
const text = document.getElementById("text");
const rawToggle = document.getElementById("rawToggle");
const modelSelect = document.getElementById("model");
const thinking = document.getElementById("thinking");
const tools = document.getElementById("tools");
const stop = document.getElementById("stop");
const note = document.getElementById("note");
const usage = document.getElementById("usage");

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

function send(msg) {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Rebuild the settings bar from the server's config. The server is the source of truth. */
function renderConfig(cfg) {
	if (modelSelect.options.length !== cfg.models.length) {
		// Group by provider; the list runs to dozens of entries.
		const groups = new Map();
		for (const key of cfg.models) {
			const provider = key.slice(0, key.indexOf("/"));
			if (!groups.has(provider)) groups.set(provider, []);
			groups.get(provider).push(key);
		}
		modelSelect.replaceChildren(
			...[...groups].map(([provider, keys]) => {
				const group = document.createElement("optgroup");
				group.label = provider;
				group.append(...keys.map((key) => new Option(key.slice(provider.length + 1), key)));
				return group;
			}),
		);
	}
	if (cfg.model) modelSelect.value = cfg.model;
	stop.disabled = !cfg.isStreaming;

	if (thinking.options.length !== cfg.thinkingLevels.length) {
		thinking.replaceChildren(
			...cfg.thinkingLevels.map((level) => new Option(level, level)),
		);
	}
	thinking.disabled = cfg.thinkingLevels.length === 0;
	thinking.value = cfg.thinkingLevel;

	if (tools.children.length !== cfg.tools.length) {
		tools.replaceChildren(
			...cfg.tools.map((tool) => {
				const box = document.createElement("input");
				box.type = "checkbox";
				box.dataset.tool = tool.name;
				box.addEventListener("change", () => {
					const names = [...tools.querySelectorAll("input:checked")].map((i) => i.dataset.tool);
					send({ type: "set_tools", names });
					note.textContent = "도구 변경은 다음 turn부터 적용됩니다";
				});
				const label = document.createElement("label");
				label.title = tool.description ?? "";
				label.append(box, ` ${tool.name}`);
				return label;
			}),
		);
	}
	for (const box of tools.querySelectorAll("input")) {
		box.checked = cfg.activeTools.includes(box.dataset.tool);
	}
}

function renderUsage(u) {
	const cost = `$${u.cost.toFixed(4)}`;
	// Percent is 0-100 and often well under 1 early on; rounding to an integer would read as 0 or 1.
	const pct = u.context?.percent;
	const ctx = pct != null ? `context ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%` : "context —";
	usage.replaceChildren(cost, " · ");
	const ctxNode = document.createElement("span");
	// Compaction kicks in near the top of the window; warn before it surprises the user.
	if (u.context?.percent != null && u.context.percent >= 70) ctxNode.className = "warn";
	ctxNode.textContent = ctx;
	usage.append(ctxNode);
	usage.title =
		`input ${u.tokens.input} · output ${u.tokens.output} · ` +
		`cache read ${u.tokens.cacheRead} · cache write ${u.tokens.cacheWrite}\n` +
		`messages ${u.messages} · tool calls ${u.toolCalls}` +
		(u.context ? `\ncontext ${u.context.tokens ?? "?"} / ${u.context.window}` : "");
}

modelSelect.addEventListener("change", () => send({ type: "set_model", model: modelSelect.value }));
thinking.addEventListener("change", () => send({ type: "set_thinking", level: thinking.value }));
stop.addEventListener("click", () => send({ type: "abort" }));

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
	if (event.type === "config") {
		renderConfig(event);
		return;
	}
	if (event.type === "usage") {
		renderUsage(event);
		return;
	}
	events.push(event);
	apply(event);
	render();
};

form.addEventListener("submit", (e) => {
	e.preventDefault();
	const value = text.value.trim();
	if (!value) return;
	send({ type: "prompt", text: value });
	text.value = "";
});
