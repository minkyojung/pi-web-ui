import { useState, useSyncExternalStore } from "react";

import { configStore, sessionsStore, usageStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { ModelSelect } from "./ModelSelect";
import { UsageView } from "./UsageView";

const BAR = "flex flex-wrap items-center gap-4 border-b px-3 py-1.5 text-xs";
const GROUP = "flex items-center gap-1.5";
const CONTROL = "rounded-md border bg-background px-2 py-1 disabled:opacity-50";

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
		setNote("도구 변경은 다음 turn부터 적용됩니다");
	};

	return (
		<div id="settings" className={BAR}>
			<span className={GROUP}>
				<select
					id="sessions"
					className={`max-w-80 ${CONTROL}`}
					disabled={!online}
					value={current?.path ?? ""}
					onChange={(e) => send({ type: "resume_session", path: e.target.value })}
				>
					{sessions.map((s) => (
						<option key={s.path} value={s.path}>
							{`${s.name ?? s.firstMessage ?? "(empty)"} · ${s.messageCount}msg · ${new Date(s.modified).toLocaleString()}`}
						</option>
					))}
				</select>
				<button id="newSession" className={CONTROL} disabled={!online} onClick={() => send({ type: "new_session" })}>
					새 대화
				</button>
			</span>
			<span className={GROUP}>
				<ModelSelect model={config.model} models={config.models} />
			</span>
			<span className={GROUP}>
				<label htmlFor="thinking">생각</label>
				<select
					id="thinking"
					className={CONTROL}
					value={config.thinkingLevel}
					disabled={!online || config.thinkingLevels.length === 0}
					onChange={(e) => send({ type: "set_thinking", level: e.target.value })}
				>
					{config.thinkingLevels.map((level) => (
						<option key={level} value={level}>
							{level}
						</option>
					))}
				</select>
			</span>
			<span className={GROUP} id="tools">
				{config.tools.map((tool) => (
					<label key={tool.name} className="flex items-center gap-1 whitespace-nowrap" title={tool.description ?? ""}>
						<input
							type="checkbox"
							disabled={!online}
							checked={config.activeTools.includes(tool.name)}
							onChange={(e) => toggleTool(tool.name, e.target.checked)}
						/>
						{` ${tool.name}`}
					</label>
				))}
			</span>
			<button id="stop" className={CONTROL} disabled={!online || !config.isStreaming} onClick={() => send({ type: "abort" })}>
				중단
			</button>
			{usage && <UsageView usage={usage} />}
			<span id="queued" className="text-[11px] text-amber-600 dark:text-amber-500">{pending ? `대기 중 ${pending}건` : ""}</span>
			<span id="note" className="text-[11px] text-muted-foreground">{note}</span>
		</div>
	);
}
