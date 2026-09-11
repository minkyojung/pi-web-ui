import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { Editor } from "./components/Editor";
import { RawView } from "./components/RawView";
import { SettingsBar } from "./components/SettingsBar";
import { Sidebar } from "./components/Sidebar";
import { QuickOpen } from "./components/QuickOpen";
import { Title } from "./components/Title";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { TooltipProvider } from "./components/ui/tooltip";
import { hashForNote, noteFromHash } from "./noteSync";
import { bump, forget, readRecent, writeRecent } from "./recent";
import { filesStore, noteCreatedStore, noteDeletedStore, noteRenamedStore } from "./serverState";
import { Button } from "./components/ui/button";
import { getConnection, getItems, subscribe } from "./store";
import { send } from "./ws";

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
	// A rename moves the address under the open note. The editor is the same
	// one — same undo history, same cursor — so it is told rather than replaced.
	const renamed = useSyncExternalStore(noteRenamedStore.subscribe, noteRenamedStore.get);
	useEffect(() => {
		if (renamed && renamed.from === noteFromHash(location.hash)) {
			history.replaceState(null, "", hashForNote(renamed.to));
			setPath(renamed.to);
		}
	}, [renamed]);
	return [path, open];
}

/**
 * A key that changes when a different note is opened and not when the open
 * one is renamed. Renames arrive with both names, so the old key is kept
 * under the new path.
 */
const identities = new Map<string, number>();
let nextIdentity = 1;
function noteIdentity(path: string): number {
	let id = identities.get(path);
	if (id === undefined) {
		id = nextIdentity++;
		identities.set(path, id);
	}
	return id;
}
noteRenamedStore.subscribe(() => {
	const renamed = noteRenamedStore.get();
	if (!renamed) return;
	const id = identities.get(renamed.from);
	if (id !== undefined) {
		identities.delete(renamed.from);
		identities.set(renamed.to, id);
	}
});

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

	// Which notes were opened, newest first, for the quick-open list. Follows
	// a rename and drops a delete, so it never names a note that is not there.
	const [recent, setRecent] = useState(readRecent);
	useEffect(() => {
		if (open) setRecent((list) => bump(list, open));
	}, [open]);
	const renamedForRecent = useSyncExternalStore(noteRenamedStore.subscribe, noteRenamedStore.get);
	useEffect(() => {
		if (renamedForRecent) setRecent((list) => forget(list, renamedForRecent.from, renamedForRecent.to));
	}, [renamedForRecent]);
	useEffect(() => {
		writeRecent(recent);
	}, [recent]);
	const [picking, setPicking] = useState(false);
	// An empty vault is a first run, or as good as one: the column says how to start.
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);

	// ⌘N asks the server for a new note; it comes back named, and is opened by
	// address like any other. The server names it, since it owns the folder.
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const created = useSyncExternalStore(noteCreatedStore.subscribe, noteCreatedStore.get);
	useEffect(() => {
		if (!created) return;
		noteCreatedStore.set(null);
		noteDeletedStore.set(null); // Whatever came back, or a new one: nothing left to restore.
		setOpen(created.path);
	}, [created, setOpen]);

	// A note in the trash is closed wherever it was open. The middle column
	// then offers to bring it back, until something else is opened.
	const deleted = useSyncExternalStore(noteDeletedStore.subscribe, noteDeletedStore.get);
	useEffect(() => {
		if (!deleted) return;
		setRecent((list) => forget(list, deleted.path));
		if (deleted.path === open) setOpen(null);
	}, [deleted, open, setOpen]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if ((e.key === "n" || e.key === "N") && mod && !e.shiftKey) {
				e.preventDefault();
				if (online) send({ type: "new_note" });
			}
			if ((e.key === "p" || e.key === "P") && mod && !e.shiftKey) {
				e.preventDefault();
				setPicking((on) => !on);
			}
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
	}, [online]);

	return (
		<TooltipProvider delayDuration={300}>
			<QuickOpen open={picking} onOpenChange={setPicking} recent={recent} onPick={setOpen} />
			<ResizablePanelGroup orientation="horizontal" className="h-screen">
				<ResizablePanel id="sidebar" defaultSize="22%" minSize="16%" className="min-w-0">
					<Sidebar open={open} onOpen={setOpen} />
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="main" minSize="30%" className="min-w-0">
					{/* A different note is a different editor, with its own history,
					    rather than one editor with its text swapped — but a renamed note
					    is the same one, so the key is the note's identity, not its path. */}
					{open ? (
						<div className="flex h-full flex-col">
							<Title path={open} />
							<Editor key={noteIdentity(open)} path={open} onOpen={setOpen} />
						</div>
					) : (
						<div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
							{deleted ? (
								<>
									<span>
										Deleted <span className="text-foreground">{deleted.path.replace(/\.md$/, "")}</span>
									</span>
									<Button
										variant="outline"
										size="sm"
										className="h-7 text-xs"
										onClick={() => send({ type: "restore_note", trashed: deleted.trashed, path: deleted.path })}
									>
										Restore
									</Button>
								</>
							) : files.length === 0 ? (
								<div className="max-w-sm text-center leading-relaxed">
									<p className="text-foreground">This folder has no notes yet.</p>
									<p className="mt-2">⌘N makes one. pi reads and writes the same files; who wrote which words is kept beside them, in .pi/.</p>
								</div>
							) : (
								<span>No note open · ⌘P to find one · ⌘N for a new one</span>
							)}
						</div>
					)}
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
