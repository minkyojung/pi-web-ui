import { useSyncExternalStore } from "react";

import { configStore, rawStore } from "../serverState";

const MOD = navigator.userAgent.includes("Mac") ? "⌘⇧D" : "Ctrl+Shift+D";

/**
 * The debug view: every message the server sent, as it arrived. What the
 * conversation is built from, for when what it was built into looks wrong.
 *
 * Events are collected whether or not this is mounted — you turn it on *after*
 * seeing something odd, so the history has to already be there — but they are
 * only serialised here, where someone is actually reading them.
 */
export function RawView() {
	const events = useSyncExternalStore(rawStore.subscribe, rawStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Nothing on screen says this view exists, so it has to say how to leave. */}
			<div className="px-3 py-1 text-xs text-muted-foreground">
				Raw events · {MOD} to close
			</div>
			{/* What is above is this window's side of it, and it goes when the window
			    does. The server's side outlives both, which is what someone asking
			    about yesterday needs — but a file nobody can find is not one, so
			    this is where it is said: the place people come when something is wrong. */}
			{config?.log && (
				<div id="log-path" className="px-3 pb-1 text-xs text-muted-foreground">
					The server writes what it says to <span className="font-mono select-all">{config.log}</span>
				</div>
			)}
			<pre id="raw" className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
				{events.map((event) => `${JSON.stringify(event, null, 2)}\n`).join("")}
			</pre>
		</div>
	);
}
