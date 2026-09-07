import { useSyncExternalStore } from "react";

import { configStore, sessionsStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";

// One height with the other two column headers, so the top of the window reads
// as a single row. Fixed rather than grown into, which also rules out wrapping.
const BAR = "drag-region flex h-11 shrink-0 items-center gap-3 border-b px-3 text-xs";

/**
 * Reconnection is automatic and unattended — a backoff of at most five seconds,
 * skipped entirely when the network returns or the tab is looked at again. So
 * this reports and is careful not to look like it is asking for something.
 * While the socket is up it draws nothing at all.
 */
function Connection() {
	const connection = useSyncExternalStore(subscribe, getConnection);
	if (connection === "open") return null;
	return (
		<span id="status" className="ml-auto text-amber-600 dark:text-amber-500">
			{connection === "connecting" ? "Connecting…" : "Offline — reconnecting automatically"}
		</span>
	);
}

export function SettingsBar() {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const sessions = useSyncExternalStore(sessionsStore.subscribe, sessionsStore.get);
	// Nothing is queued while the socket is down, so a control that still looked
	// live would silently do nothing.
	const online = useSyncExternalStore(subscribe, getConnection) === "open";

	// The server is the source of truth for all of this and has not spoken yet —
	// which is exactly when the connection line has something to say, so it is
	// drawn on this path too.
	if (!config)
		return (
			<div id="settings" className={BAR}>
				<Connection />
			</div>
		);

	const current = sessions.find((s) => s.current);

	return (
		<div id="settings" className={BAR}>
			<NativeSelect
				id="sessions"
				className="max-w-72"
				disabled={!online}
				value={current?.path ?? ""}
				onChange={(e) => send({ type: "resume_session", path: e.target.value })}
			>
				{sessions.map((s) => (
					<option key={s.path} value={s.path}>
						{`${s.name ?? s.firstMessage ?? "(empty)"} · ${s.messageCount}msg · ${new Date(s.modified).toLocaleString()}`}
					</option>
				))}
			</NativeSelect>
			<Button
				id="newSession"
				variant="outline"
				size="sm"
				className="h-8 text-xs"
				disabled={!online}
				onClick={() => send({ type: "new_session" })}
			>
				New
			</Button>
			<Connection />
		</div>
	);
}
