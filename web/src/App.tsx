import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { RawView } from "./components/RawView";
import { Article } from "./components/reader/Article";
import { List } from "./components/reader/List";
import { SettingsBar } from "./components/SettingsBar";
import { Today } from "./components/today/Today";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { TooltipProvider } from "./components/ui/tooltip";
import type { Flags } from "./components/reader/RowActions";
import type { FullItem, ListItem } from "./reader";
import { getConnection, getItems, subscribe } from "./store";

/**
 * The address carries what is open — a piece by id, or the day's page — so a
 * reload lands where you left off.
 */
type Route = { kind: "today" } | { kind: "piece"; id: number } | { kind: "none" };

const routeFromHash = (): Route => {
	if (location.hash === "#today") return { kind: "today" };
	const n = Number(location.hash.slice(1));
	return Number.isInteger(n) && n > 0 ? { kind: "piece", id: n } : { kind: "none" };
};

const hashFor = (route: Route) =>
	route.kind === "today" ? "#today" : route.kind === "piece" ? `#${route.id}` : "";

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
						onSave={lib.save}
						items={lib.items}
						selectedId={lib.selectedId}
						onSelect={lib.select}
						onFlags={lib.setFlags}
						today={lib.today}
						onToday={lib.openToday}
					/>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="article" minSize="30%" className="min-w-0">
					{/* The middle column draws a piece or the day; the list and pi do not
					    know which, and neither does the column's size. */}
					{lib.today ? <Today /> : <Article item={lib.current} onRefetch={lib.refetch} />}
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
					<Composer piece={lib.attached} onDetach={lib.detach} />
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
	const [route, setRoute] = useState<Route>(routeFromHash);
	const selectedId = route.kind === "piece" ? route.id : null;
	const [current, setCurrent] = useState<FullItem | null>(null);
	// Attached again whenever another piece is opened: the common case is asking
	// about what is on screen, and detaching is about this question, not for good.
	const [detached, setDetached] = useState(false);

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

	// A url in. The row comes back from the server like a flag does, and goes to
	// the top rather than being opened: opening marks it read, and the point of
	// saving something is to read it later. One that was already here is opened
	// instead — the answer to "do I have this?" is to show it.
	const save = useCallback(async (url: string): Promise<{ created: boolean; row: ListItem }> => {
		const r = await fetch("/api/items", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ url }),
		});
		const body = (await r.json().catch(() => ({}))) as { error?: string } & Partial<ListItem>;
		if (!r.ok) throw new Error(body.error ?? `${r.status}`);
		const row = body as ListItem;
		const created = r.status === 201;
		setItems((prev) => (created ? [row, ...prev] : prev.map((it) => (it.id === row.id ? row : it))));
		if (!created) setRoute({ kind: "piece", id: row.id });
		return { created, row };
	}, []);

	// Asking for a body again. Unlike every other request here this one does not
	// swallow its failure: it is an answer to a click, and a button that does
	// nothing at all is worse than one that says why.
	const refetch = useCallback(async (id: number) => {
		const r = await fetch(`/api/items/${id}/refetch`, { method: "POST" });
		const body = (await r.json().catch(() => ({}))) as { error?: string } & Partial<FullItem>;
		if (!r.ok) throw new Error(body.error ?? `${r.status}`);
		const full = body as FullItem;
		setCurrent((cur) => (cur?.id === full.id ? full : cur));
		setItems((prev) => prev.map((it) => (it.id === full.id ? { ...it, ...full } : it)));
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
		const onHash = () => setRoute(routeFromHash());
		addEventListener("hashchange", onHash);
		return () => removeEventListener("hashchange", onHash);
	}, []);

	// The hash follows the route rather than each place that changes it, so the
	// day's page and a piece are written the same way.
	useEffect(() => {
		const want = hashFor(route);
		if (want && location.hash !== want) location.hash = want;
	}, [route]);

	useEffect(() => {
		// Nothing open also means nothing attached: the composer offers what is on
		// screen, and on the day's page that is not a piece.
		if (selectedId == null) {
			setCurrent(null);
			return;
		}
		setCurrent(null);
		setDetached(false);
		fetch(`/api/items/${selectedId}`)
			.then((r) => (r.ok ? r.json() : null))
			.then(setCurrent)
			.catch(() => {});
		setFlags(selectedId, { read: true });
	}, [selectedId, setFlags]);

	return {
		items,
		selectedId,
		today: route.kind === "today",
		current,
		attached: detached ? null : current,
		detach: () => setDetached(true),
		select: (id: number) => setRoute({ kind: "piece", id }),
		openToday: () => setRoute({ kind: "today" }),
		setFlags,
		save,
		refetch,
	};
}
