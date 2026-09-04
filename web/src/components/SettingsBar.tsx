import { useState, useSyncExternalStore } from "react";

import { configStore, sessionsStore, usageStore } from "../serverState";
import { send } from "../ws";
import { ModelSelect } from "./ModelSelect";
import { UsageView } from "./UsageView";

export function SettingsBar() {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const usage = useSyncExternalStore(usageStore.subscribe, usageStore.get);
	const sessions = useSyncExternalStore(sessionsStore.subscribe, sessionsStore.get);
	const [note, setNote] = useState("");

	// The server is the source of truth for all of this, and it has not spoken yet.
	if (!config) return <div id="settings" />;

	const current = sessions.find((s) => s.current);
	const pending = config.queued.steering.length + config.queued.followUp.length;

	const toggleTool = (name: string, on: boolean) => {
		const names = on ? [...config.activeTools, name] : config.activeTools.filter((n) => n !== name);
		send({ type: "set_tools", names });
		setNote("도구 변경은 다음 turn부터 적용됩니다");
	};

	return (
		<div id="settings">
			<span className="group">
				<select
					id="sessions"
					value={current?.path ?? ""}
					onChange={(e) => send({ type: "resume_session", path: e.target.value })}
				>
					{sessions.map((s) => (
						<option key={s.path} value={s.path}>
							{`${s.name ?? s.firstMessage ?? "(empty)"} · ${s.messageCount}msg · ${new Date(s.modified).toLocaleString()}`}
						</option>
					))}
				</select>
				<button id="newSession" onClick={() => send({ type: "new_session" })}>
					새 대화
				</button>
			</span>
			<span className="group">
				<ModelSelect model={config.model} models={config.models} />
			</span>
			<span className="group">
				<label htmlFor="thinking">생각</label>
				<select
					id="thinking"
					value={config.thinkingLevel}
					disabled={config.thinkingLevels.length === 0}
					onChange={(e) => send({ type: "set_thinking", level: e.target.value })}
				>
					{config.thinkingLevels.map((level) => (
						<option key={level} value={level}>
							{level}
						</option>
					))}
				</select>
			</span>
			<span className="group" id="tools">
				{config.tools.map((tool) => (
					<label key={tool.name} title={tool.description ?? ""}>
						<input
							type="checkbox"
							checked={config.activeTools.includes(tool.name)}
							onChange={(e) => toggleTool(tool.name, e.target.checked)}
						/>
						{` ${tool.name}`}
					</label>
				))}
			</span>
			<button id="stop" disabled={!config.isStreaming} onClick={() => send({ type: "abort" })}>
				중단
			</button>
			{usage && <UsageView usage={usage} />}
			<span id="queued">{pending ? `대기 중 ${pending}건` : ""}</span>
			<span id="note">{note}</span>
		</div>
	);
}
