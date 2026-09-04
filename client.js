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
const behavior = document.getElementById("behavior");
const queued = document.getElementById("queued");
const sessionSelect = document.getElementById("sessions");
const newSession = document.getElementById("newSession");

/** How many raw events the debug view keeps. Older ones are dropped, not the server's copy. */
const RAW_LIMIT = 300;

/** Rendered conversation items, built from the event stream. Each owns its DOM node. */
const items = [];
/** Items whose node is out of date, flushed once per animation frame. */
const dirty = new Set();
let frame = null;
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
	const pending = cfg.queued.steering.length + cfg.queued.followUp.length;
	queued.textContent = pending ? `대기 중 ${pending}건` : "";

	for (const box of tools.querySelectorAll("input")) {
		box.checked = cfg.activeTools.includes(box.dataset.tool);
	}
}

function renderSessions(list) {
	sessionSelect.replaceChildren(
		...list.map((s) => {
			const when = new Date(s.modified).toLocaleString();
			const label = s.name ?? s.firstMessage ?? "(empty)";
			const option = new Option(`${label} · ${s.messageCount}msg · ${when}`, s.path);
			option.selected = s.current;
			return option;
		}),
	);
}

newSession.addEventListener("click", () => send({ type: "new_session" }));
sessionSelect.addEventListener("change", () => send({ type: "resume_session", path: sessionSelect.value }));

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

function el(tag, className, textContent) {
	const node = document.createElement(tag);
	node.className = className;
	if (textContent !== undefined) node.textContent = textContent;
	return node;
}

function createNode(item) {
	if (item.kind === "tool") {
		const node = el("div", "item tool");
		const pre = el("pre", "");
		pre.hidden = true;
		node.append(el("span", "name", item.name), ` ${JSON.stringify(item.args)}`, pre);
		item.pre = pre;
		return node;
	}
	return el("div", `item ${item.kind}`, item.kind === "done" ? "— 완료 —" : item.text);
}

function updateNode(item) {
	if (item.kind === "tool") {
		if (item.result === null) return;
		item.pre.hidden = false;
		item.pre.className = item.isError ? "error" : "";
		item.pre.textContent = item.result;
	} else if (item.kind !== "done") {
		item.node.textContent = item.text;
	}
}

/** Append one item and its node. Only this item's node is created; the rest are untouched. */
function addItem(item) {
	items.push(item);
	item.node = createNode(item);
	chat.append(item.node);
	// A new node changes the height, so the scroll position needs a pass too.
	scheduleFlush();
	return item;
}

function scheduleFlush() {
	if (frame === null) frame = requestAnimationFrame(flush);
}

function touch(item) {
	dirty.add(item);
	scheduleFlush();
}

/**
 * Deltas arrive far faster than the screen repaints, so updates are coalesced
 * into one frame and only the changed items are rewritten.
 */
function flush() {
	frame = null;
	const main = chat.parentElement;
	const atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 40;
	for (const item of dirty) updateNode(item);
	dirty.clear();
	if (atBottom) main.scrollTop = main.scrollHeight;
}

function pushRaw(event) {
	raw.append(`${JSON.stringify(event, null, 2)}\n`);
	while (raw.childNodes.length > RAW_LIMIT) raw.removeChild(raw.firstChild);
}

function apply(event) {
	switch (event.type) {
		case "agent_start":
			status.textContent = "working…";
			break;

		case "message_start":
			if (event.message?.role === "user") addItem({ kind: "user", text: textOf(event.message) });
			break;

		case "message_update": {
			const sub = event.assistantMessageEvent;
			if (sub.type === "text_start") {
				openText = addItem({ kind: "assistant", text: "" });
			} else if (sub.type === "text_delta") {
				if (!openText) openText = addItem({ kind: "assistant", text: "" });
				openText.text += sub.delta;
				touch(openText);
			} else if (sub.type === "text_end") {
				openText = null;
			}
			break;
		}

		case "message_end":
			// Provider failures arrive here, not as a thrown error on the server.
			if (event.message?.stopReason === "error") {
				addItem({ kind: "error", text: errorText(event.message.errorMessage ?? "unknown error") });
			} else if (event.message?.role === "assistant" && !openText && textOf(event.message)) {
				// Non-streaming reply: no text_delta ever arrived.
				const already = items.some((i) => i.kind === "assistant" && i.text === textOf(event.message));
				if (!already) addItem({ kind: "assistant", text: textOf(event.message) });
			}
			openText = null;
			break;

		case "tool_execution_start": {
			const item = addItem({ kind: "tool", name: event.toolName, args: event.args, result: null, isError: false });
			openTools.set(event.toolCallId, item);
			break;
		}

		case "tool_execution_end": {
			const item = openTools.get(event.toolCallId);
			if (item) {
				item.result = resultText(event.result);
				item.isError = event.isError;
				touch(item);
				openTools.delete(event.toolCallId);
			}
			break;
		}

		case "agent_settled":
			status.textContent = "idle";
			addItem({ kind: "done" });
			break;

		case "error":
			addItem({ kind: "error", text: event.message });
			break;
	}
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
	if (event.type === "sessions") {
		renderSessions(event.sessions);
		return;
	}
	if (event.type === "snapshot") {
		// A replaced session emits no events for its history, so rebuild from this.
		items.length = 0;
		dirty.clear();
		openText = null;
		openTools.clear();
		for (const incoming of event.items) {
			const item = incoming.kind === "error" ? { ...incoming, text: errorText(incoming.text) } : { ...incoming };
			items.push(item);
			item.node = createNode(item);
			updateNode(item);
		}
		chat.replaceChildren(...items.map((item) => item.node));
		return;
	}
	pushRaw(event);
	apply(event);
};

form.addEventListener("submit", (e) => {
	e.preventDefault();
	const value = text.value.trim();
	if (!value) return;
	send({ type: "prompt", text: value, behavior: behavior.value });
	text.value = "";
});
