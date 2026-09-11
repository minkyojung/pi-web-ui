import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { Editor } from "./components/Editor";
import { RawView } from "./components/RawView";
import { SettingsBar } from "./components/SettingsBar";
import { Sidebar } from "./components/Sidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { TooltipProvider } from "./components/ui/tooltip";
import { hashForNote, noteFromHash } from "./noteSync";
import { getItems, subscribe } from "./store";

/**
 * The address carries which note is open, so a reload lands where you left
 * off and a row in the sidebar is a link rather than a call.
 */
function useOpenNote(): [string | null, (path: string | null) => void] {
	const [path, setPath] = useState(() => noteFromHash(location.hash));
	useEffect(() => {
		const onHash = () => setPath(noteFromHash(location.hash));
		addEventListener("hashchange", onHash);
		return () => removeEventListener("hashchange", onHash);
	}, []);
	const open = useCallback((next: string | null) => {
		location.hash = next ? hashForNote(next) : "";
	}, []);
	return [path, open];
}

/**
 * Three columns: the notes, the open one, and pi. pi is not an assistant off
 * to the side; it is the other person at the table, and the column is its
 * seat. It collapses with ⌘\ so it can be ignored.
 */
export function App() {
	const items = useSyncExternalStore(subscribe, getItems);
	const [open, setOpen] = useOpenNote();
	// A debug view, so it is behind a shortcut rather than a permanent control in
	// the best seat on screen. RawView says how to leave, since nothing says it
	// is there in the first place.
	const [raw, setRaw] = useState(false);
	const pi = useRef<PanelImperativeHandle>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if ((e.key === "d" || e.key === "D") && e.shiftKey && mod) {
				e.preventDefault();
				setRaw((on) => !on);
			}
			if (e.key === "\\" && mod) {
				e.preventDefault();
				const panel = pi.current;
				if (panel) panel.isCollapsed() ? panel.expand() : panel.collapse();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<TooltipProvider delayDuration={300}>
			<ResizablePanelGroup orientation="horizontal" className="h-screen">
				<ResizablePanel id="sidebar" defaultSize="22%" minSize="16%" className="min-w-0">
					<Sidebar open={open} onOpen={setOpen} />
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="main" minSize="30%" className="min-w-0">
					{/* Keyed by path so a different note is a different editor, with its
					    own history, rather than one editor with its text swapped. */}
					{open ? <Editor key={open} path={open} /> : <div id="main" className="h-full" />}
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel
					id="pi"
					panelRef={pi}
					defaultSize="30%"
					minSize="20%"
					collapsible
					collapsedSize="0%"
					className="flex min-w-0 flex-col border-l"
				>
					<SettingsBar />
					{/* The two views used to be swapped by a body.raw class, which has no
					    home in a utility stylesheet — and only one was ever read. */}
					{raw ? <RawView /> : <Conversation items={items} />}
					<Composer note={open} />
				</ResizablePanel>
			</ResizablePanelGroup>
		</TooltipProvider>
	);
}
