import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { RawView } from "./components/RawView";
import { Article } from "./components/reader/Article";
import { List } from "./components/reader/List";
import { SettingsBar } from "./components/SettingsBar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { TooltipProvider } from "./components/ui/tooltip";
import type { Flags } from "./components/reader/RowActions";
import type { FullItem, ListItem } from "./reader";
import { getConnection, getItems, subscribe } from "./store";

/** The address carries the open piece, so a reload lands where you left off. */
const idFromHash = () => {
	const n = Number(location.hash.slice(1));
	return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Four columns: rail, list, the piece, and pi. pi is not an assistant off to
 * the side; it is the other reader at the table, and the column is its seat.
 * It collapses with ⌘\ so it can be ignored — what it has left in the library
 * stays on the list either way.
 */
export function App() {
	const items = useSyncExternalStore(subscribe, getItems);
	const lib = useLibrary();
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
				<ResizablePanel id="list" defaultSize="22%" minSize="16%" className="min-w-0">
					<List
						items={lib.items}
						selectedId={lib.selectedId}
						onSelect={lib.select}
						onFlags={lib.setFlags}
					/>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="article" minSize="30%" className="min-w-0">
					<Article item={lib.current} />
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
					<Composer />
				</ResizablePanel>
			</ResizablePanelGroup>
		</TooltipProvider>
	);
}

/**
 * The library's list and the open piece share one selection, kept in the hash.
 *
 * Read, queued and archived go to the library rather than to this browser. pi
 * reads the same files; a mark it cannot see would make it the one participant
 * who does not know what has already been dealt with.
 */
function useLibrary() {
	const [items, setItems] = useState<ListItem[]>([]);
	const [selectedId, setSelectedId] = useState<number | null>(idFromHash);
	const [current, setCurrent] = useState<FullItem | null>(null);

	// The row is updated from the server's answer, not from a guess made here, so
	// the list cannot drift from the file if a write is refused.
	const setFlags = useCallback((id: number, patch: Flags) => {
		fetch(`/api/items/${id}/flags`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(patch),
		})
			.then((r) => (r.ok ? r.json() : null))
			.then((row: ListItem | null) => {
				if (row) setItems((prev) => prev.map((it) => (it.id === row.id ? row : it)));
			})
			.catch(() => {});
	}, []);

	// The list is fetched once the socket is up, not on mount: the server takes a
	// few seconds to bring the pi session up, and a request before that gets a
	// proxy error. Reconnecting refetches too, which is also how a fetch pass
	// made while the tab was open reaches the list.
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	useEffect(() => {
		if (!online) return;
		fetch("/api/items?limit=500")
			.then((r) => (r.ok ? r.json() : []))
			.then(setItems)
			.catch(() => {});
	}, [online]);

	useEffect(() => {
		const onHash = () => setSelectedId(idFromHash());
		addEventListener("hashchange", onHash);
		return () => removeEventListener("hashchange", onHash);
	}, []);

	useEffect(() => {
		if (selectedId == null) return;
		if (idFromHash() !== selectedId) location.hash = String(selectedId);
		setCurrent(null);
		fetch(`/api/items/${selectedId}`)
			.then((r) => (r.ok ? r.json() : null))
			.then(setCurrent)
			.catch(() => {});
		setFlags(selectedId, { read: true });
	}, [selectedId, setFlags]);

	return { items, selectedId, current, select: setSelectedId, setFlags };
}
