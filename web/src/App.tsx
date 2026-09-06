import { useEffect, useState, useSyncExternalStore } from "react";

import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { RawView } from "./components/RawView";
import { SettingsBar } from "./components/SettingsBar";
import { TooltipProvider } from "./components/ui/tooltip";
import { getItems, subscribe } from "./store";

export function App() {
	const items = useSyncExternalStore(subscribe, getItems);
	// A debug view, so it is behind a shortcut rather than a permanent control in
	// the best seat on screen. RawView says how to leave, since nothing says it
	// is there in the first place.
	const [raw, setRaw] = useState(false);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.key === "d" || e.key === "D") && e.shiftKey && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setRaw((on) => !on);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<TooltipProvider delayDuration={300}>
			<SettingsBar />
			{/* The two views used to be swapped by a body.raw class, which has no
			    home in a utility stylesheet — and only one was ever read. */}
			{raw ? <RawView /> : <Conversation items={items} />}
			<Composer />
		</TooltipProvider>
	);
}
