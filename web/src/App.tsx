import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Conversation } from "./components/Conversation";
import { RawView } from "./components/RawView";
import { SettingsBar } from "./components/SettingsBar";
import { getAgentStatus, getConnection, getItems, subscribe } from "./store";
import { send } from "./ws";

export function App() {
	const items = useSyncExternalStore(subscribe, getItems);
	const agentStatus = useSyncExternalStore(subscribe, getAgentStatus);
	const connection = useSyncExternalStore(subscribe, getConnection);
	const [raw, setRaw] = useState(false);
	const online = connection === "open";
	// While the socket is down the run status is whatever it was, which would be
	// a lie; say what is actually happening instead.
	const status = online ? agentStatus : connection === "connecting" ? "connecting…" : "reconnecting…";
	const text = useRef<HTMLInputElement>(null);
	const behavior = useRef<HTMLSelectElement>(null);

	// The stylesheet swaps the two views off body.raw rather than off a prop.
	useEffect(() => {
		document.body.classList.toggle("raw", raw);
	}, [raw]);

	return (
		<>
			<header>
				<form
					id="form"
					style={{ display: "contents" }}
					onSubmit={(e) => {
						e.preventDefault();
						const value = text.current?.value.trim();
						if (!value) return;
						send({ type: "prompt", text: value, behavior: behavior.current?.value });
						if (text.current) text.current.value = "";
					}}
				>
					{/* Uncontrolled: a keystroke should not re-render the conversation. */}
					<input id="text" ref={text} placeholder="pi에게 보낼 말" autoComplete="off" autoFocus />
					<select id="behavior" ref={behavior} title="작업 중일 때 보낸 말을 어떻게 처리할지">
						<option value="followUp">기다렸다 보내기</option>
						<option value="steer">바로 끼어들기</option>
					</select>
					<button disabled={!online}>send</button>
				</form>
				<label>
					<input type="checkbox" id="rawToggle" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> raw
				</label>
				<span id="status">{status}</span>
			</header>
			<SettingsBar />
			<Conversation items={items}>{raw && <RawView />}</Conversation>
		</>
	);
}
