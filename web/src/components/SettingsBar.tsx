import { useState, useSyncExternalStore } from "react";

import { configStore, sessionsStore, usageStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { ToolToggles } from "./ToolToggles";
import { UsageView } from "./UsageView";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";

const BAR = "flex flex-wrap items-center gap-3 border-b px-3 py-1.5 text-xs";

export function SettingsBar() {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const usage = useSyncExternalStore(usageStore.subscribe, usageStore.get);
	const sessions = useSyncExternalStore(sessionsStore.subscribe, sessionsStore.get);
	const [note, setNote] = useState("");
	// Nothing is queued while the socket is down, so a control that still looked
	// live would silently do nothing.
	const online = useSyncExternalStore(subscribe, getConnection) === "open";

	// The server is the source of truth for all of this, and it has not spoken yet.
	if (!config) return <div id="settings" className={BAR} />;

	const current = sessions.find((s) => s.current);
	const pending = config.queued.steering.length + config.queued.followUp.length;

	const toggleTool = (name: string, on: boolean) => {
		const names = on ? [...config.activeTools, name] : config.activeTools.filter((n) => n !== name);
		send({ type: "set_tools", names });
		setNote("Tool changes apply from the next turn");
	};

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

			<ToolToggles tools={config.tools} active={config.activeTools} disabled={!online} onToggle={toggleTool} />

			{usage && <UsageView usage={usage} />}
			{pending > 0 && (
				<Badge id="queued" variant="secondary">
					{pending} queued
				</Badge>
			)}
			<span id="note" className="text-[11px] text-muted-foreground">
				{note}
			</span>
		</div>
	);
}
