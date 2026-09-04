const log = document.getElementById("log");
const status = document.getElementById("status");
const form = document.getElementById("form");
const text = document.getElementById("text");
const compact = document.getElementById("compact");

/** Every event, unmodified. Re-rendered when the compact toggle flips. */
const events = [];

function line(event) {
	if (!compact.checked) return JSON.stringify(event, null, 2);
	if (event.type === "message_update") {
		const sub = event.assistantMessageEvent;
		return `message_update.${sub.type}${sub.delta ? ` ${JSON.stringify(sub.delta)}` : ""}`;
	}
	return event.type;
}

function render() {
	log.textContent = events.map(line).join("\n");
	log.scrollTop = log.scrollHeight;
}

compact.addEventListener("change", render);

const ws = new WebSocket(`ws://${location.host}`);
ws.onopen = () => (status.textContent = "connected");
ws.onclose = () => (status.textContent = "disconnected");
ws.onmessage = (e) => {
	events.push(JSON.parse(e.data));
	render();
};

form.addEventListener("submit", (e) => {
	e.preventDefault();
	if (!text.value.trim()) return;
	ws.send(JSON.stringify({ type: "prompt", text: text.value }));
	text.value = "";
});
