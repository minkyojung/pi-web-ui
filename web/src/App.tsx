import { useState, useSyncExternalStore } from "react";

import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { RawView } from "./components/RawView";
import { SettingsBar } from "./components/SettingsBar";
import { Checkbox } from "./components/ui/checkbox";
import { Label } from "./components/ui/label";
import { TooltipProvider } from "./components/ui/tooltip";
import { getAgentStatus, getConnection, getItems, subscribe } from "./store";

export function App() {
	const items = useSyncExternalStore(subscribe, getItems);
	const agentStatus = useSyncExternalStore(subscribe, getAgentStatus);
	const connection = useSyncExternalStore(subscribe, getConnection);
	const [raw, setRaw] = useState(false);

	const online = connection === "open";
	// While the socket is down the run status is whatever it was, which would be
	// a lie; say what is actually happening instead.
	const status = online ? agentStatus : connection === "connecting" ? "connecting…" : "reconnecting…";

	return (
		<TooltipProvider delayDuration={300}>
			<header className="flex items-center gap-3 border-b px-3 py-2">
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
			<Composer />
		</TooltipProvider>
	);
}
