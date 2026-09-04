import { useRef, useState, useSyncExternalStore } from "react";

import { Conversation } from "./components/Conversation";
import { RawView } from "./components/RawView";
import { SettingsBar } from "./components/SettingsBar";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { NativeSelect } from "./components/ui/native-select";
import { TooltipProvider } from "./components/ui/tooltip";
import { getAgentStatus, getConnection, getItems, subscribe } from "./store";
import { send } from "./ws";

export function App() {
	const items = useSyncExternalStore(subscribe, getItems);
	const agentStatus = useSyncExternalStore(subscribe, getAgentStatus);
	const connection = useSyncExternalStore(subscribe, getConnection);
	const [raw, setRaw] = useState(false);
	const text = useRef<HTMLInputElement>(null);
	const behavior = useRef<HTMLSelectElement>(null);

	const online = connection === "open";
	// While the socket is down the run status is whatever it was, which would be
	// a lie; say what is actually happening instead.
	const status = online ? agentStatus : connection === "connecting" ? "connecting…" : "reconnecting…";

	return (
		<TooltipProvider delayDuration={300}>
			<header className="flex items-center gap-3 border-b px-3 py-2">
				<form
					id="form"
					className="contents"
					onSubmit={(e) => {
						e.preventDefault();
						const value = text.current?.value.trim();
						if (!value) return;
						send({ type: "prompt", text: value, behavior: behavior.current?.value });
						if (text.current) text.current.value = "";
					}}
				>
					{/* Uncontrolled: a keystroke should not re-render the conversation. */}
					<Input id="text" ref={text} className="flex-1" placeholder="pi에게 보낼 말" autoComplete="off" autoFocus />
					<NativeSelect
						id="behavior"
						ref={behavior}
						className="w-36"
						title="작업 중일 때 보낸 말을 어떻게 처리할지"
					>
						<option value="followUp">기다렸다 보내기</option>
						<option value="steer">바로 끼어들기</option>
					</NativeSelect>
					<Button type="submit" size="sm" className="h-8" disabled={!online}>
						send
					</Button>
				</form>
				<Label className="gap-1.5 text-xs font-normal whitespace-nowrap">
					<Checkbox id="rawToggle" checked={raw} onCheckedChange={(on) => setRaw(on === true)} /> raw
				</Label>
				<span
					id="status"
					className={`min-w-20 text-xs ${online ? "text-muted-foreground" : "text-amber-600 dark:text-amber-500"}`}
				>
					{status}
				</span>
			</header>
			<SettingsBar />
			{/* The two views used to be swapped by a body.raw class, which has no
			    home in a utility stylesheet — and only one was ever read. */}
			{raw ? <RawView /> : <Conversation items={items} />}
		</TooltipProvider>
	);
}
