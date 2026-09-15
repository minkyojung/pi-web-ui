import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type PanelImperativeHandle, useDefaultLayout } from "react-resizable-panels";

import { Editor } from "./components/Editor";
import { Pi } from "./components/Pi";
import { PiToggle } from "./components/PanelHeader";
import { Sidebar, Steps } from "./components/Sidebar";
import { QuickOpen } from "./components/QuickOpen";
import { Search } from "./components/Search";
import { Title } from "./components/Title";
import { Boundary } from "./components/Boundary";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { TooltipProvider } from "./components/ui/tooltip";
import type { Place } from "../../links.ts";
import { hashForNote, noteFromHash } from "./noteSync";
import { NoteTabs } from "./components/NoteTabs";
import { bump, forget, readRecent, writeRecent } from "./recent";
import { back as stepBack, canBack, canForward, forget as forgetStep, forward as stepForward, go, here, type Left, type Nav, read as readNav, remember, replace, write as writeNav } from "./nav";
import { type Closed, add as addTab, close as closeTabIn, move, neighbour, readTabs, reopen, writeTabs } from "./tabs";
import { filesStore, noteCreatedStore, noteDeletedStore, noteRenamedStore } from "./serverState";
import { Button } from "./components/ui/button";
import { getConnection, subscribe } from "./store";
import { send } from "./ws";

/**
 * Which note is in the middle column, and the way back to the ones before it.
 *
 * Where you have been is the list (nav.ts) and it is what is asked; the
 * address is written from it rather than read into it, so that a reload lands
 * where you left off and a row in the sidebar is a link rather than a call.
 * It is written with replaceState, which adds nothing to the browser's own
 * list: the two would otherwise be stepped through at once, each a step
 * behind the other. An address typed by hand still arrives, as a step like
 * any other.
 *
 * A followed link can also say where in the note to land. That is part of the
 * step — going back to it should land there again — and is handed to the
 * editor for as long as it is the step we stand on.
 */
type Opened = {
	open: string | null;
	place: Place | null;
	/** Where this step was being read when it was last stepped off. */
	left: Left | null;
	/** Where it is being read now, for the step to keep. */
	onLeave: (left: Left) => void;
	/** Somewhere was opened: a step. */
	setOpen: (path: string | null, place?: Place) => void;
	/** The note in front went away and another stands there now: not a step. */
	showInstead: (path: string | null) => void;
	/** A step back along the list, and one forward again. Neither adds to it. */
	back: () => void;
	forward: () => void;
	canBack: boolean;
	canForward: boolean;
};
function useOpenNote(): Opened {
	// The list outlives the window, as the row of tabs does. The address wins
	// where the two disagree — a link followed into a new window names a note
	// the last one never had — and agrees with it far more often, which is how
	// a reload keeps the way back.
	const [nav, setNav] = useState<Nav>(() => {
		const saved = readNav();
		const path = noteFromHash(location.hash);
		if (!path) return saved;
		return here(saved)?.path === path ? saved : go(saved, path);
	});
	// Nothing in the middle column, with the list left standing where it is:
	// the last tab closed, or a window opened at no address. Opening anything
	// fills it again, and the way back is still there.
	const [blank, setBlank] = useState(() => noteFromHash(location.hash) === null);
	const entry = blank ? null : here(nav);
	const open = entry?.path ?? null;

	useEffect(() => {
		const want = open ? hashForNote(open) : "";
		if (location.hash !== want) history.replaceState(null, "", want || location.pathname + location.search);
	}, [open]);

	// Only ever from outside — another window's link, an address typed in —
	// since what this writes is written silently.
	useEffect(() => {
		const onHash = () => {
			const path = noteFromHash(location.hash);
			setBlank(path === null);
			if (path) setNav((nav) => go(nav, path));
		};
		addEventListener("hashchange", onHash);
		return () => removeEventListener("hashchange", onHash);
	}, []);

	const setOpen = useCallback((next: string | null, place?: Place) => {
		setBlank(next === null);
		if (!next) return;
		setNav((nav) => {
			// Stepping off a note that has gone to the trash: it kept its step while
			// it was in front and the column under it offered it back, and now that
			// it is not, it is not a step to come back to either.
			const leaving = here(nav)?.path;
			const gone = leaving !== undefined && noteDeletedStore.get()?.path === leaving;
			return go(gone ? forgetStep(nav, leaving) : nav, next, place);
		});
	}, []);
	const showInstead = useCallback((next: string | null) => {
		setBlank(next === null);
		if (next) setNav((nav) => replace(nav, next));
	}, []);

	// Where the note is being read is the step's, not the note's: a note stood
	// in twice, read at the top in one step and at its end in another, comes
	// back to each as it was. The step is named in the callback the editor
	// holds, so what it reports goes to the one it was drawn for.
	const step = entry?.id;
	const onLeave = useCallback(
		(left: Left) => {
			if (step !== undefined) setNav((nav) => remember(nav, step, left));
		},
		[step],
	);

	// Going back from a window showing nothing — the last tab was closed —
	// leaves the step it was standing on behind, as closing a tab and going
	// back would anywhere else. With nowhere to go, nothing happens at all:
	// forward is not a way to reopen what you have just closed.
	const goBack = useCallback(() => {
		if (!canBack(nav)) return;
		setBlank(false);
		setNav(stepBack);
	}, [nav]);
	const goForward = useCallback(() => {
		if (!canForward(nav)) return;
		setBlank(false);
		setNav(stepForward);
	}, [nav]);

	// A rename moves the address under the open note, and under every step
	// that named it. The editor is the same one — same undo history, same
	// cursor — so it is told rather than replaced.
	const renamed = useSyncExternalStore(noteRenamedStore.subscribe, noteRenamedStore.get);
	useEffect(() => {
		if (renamed) setNav((nav) => forgetStep(nav, renamed.from, renamed.to));
	}, [renamed]);

	// A note in the trash is no longer somewhere to go, so it goes from the
	// list — every step but the one we are standing on, which keeps it while
	// the column under it offers it back. Stepping off is what forgets that
	// one, above.
	const deleted = useSyncExternalStore(noteDeletedStore.subscribe, noteDeletedStore.get);
	useEffect(() => {
		if (deleted) setNav((nav) => (here(nav)?.path === deleted.path ? nav : forgetStep(nav, deleted.path)));
	}, [deleted]);

	useEffect(() => {
		writeNav(nav);
	}, [nav]);

	return { open, place: entry?.place ?? null, left: entry?.left ?? null, onLeave, setOpen, showInstead, back: goBack, forward: goForward, canBack: canBack(nav), canForward: canForward(nav) };
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
	const { open, place, left, onLeave, setOpen, showInstead, back, forward, canBack, canForward } = useOpenNote();
	// A debug view, so it is behind a shortcut rather than a permanent control in
	// the best seat on screen. RawView says how to leave, since nothing says it
	// is there in the first place.
	const [raw, setRaw] = useState(false);
	const pi = useRef<PanelImperativeHandle>(null);
	// Whether the pi column is shown. The panel is the source of truth — it
	// collapses by drag, by key and by button alike — and reports through
	// onResize, so the toggle that brings it back can be drawn where it is not.
	const [piOpen, setPiOpen] = useState(true);
	// The columns' widths, and whether pi is folded away, outlive the window:
	// the shadcn sidebar keeps its open state in a cookie for the same reason.
	// Two groups, because the window divides twice and the divisions are not
	// peers: the sidebar is cut off from everything else, and what is left is
	// cut again into the note and pi. Each keeps its own widths.
	const columns = useDefaultLayout({ id: "columns", storage: localStorage, panelIds: ["sidebar", "content"] });
	const panes = useDefaultLayout({ id: "panes", storage: localStorage, panelIds: ["main", "pi"] });
	const togglePi = useCallback(() => {
		const panel = pi.current;
		if (panel) panel.isCollapsed() ? panel.expand() : panel.collapse();
	}, []);

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

	// Which notes are open in the middle column, left to right. Opening a note
	// adds a tab; the address says which is in front. A rename follows the way
	// the recent list does, and closing the one in front puts its neighbour there.
	const [tabs, setTabs] = useState(readTabs);
	useEffect(() => {
		if (open) setTabs((list) => addTab(list, open));
	}, [open]);
	useEffect(() => {
		if (renamedForRecent) setTabs((list) => forget(list, renamedForRecent.from, renamedForRecent.to));
	}, [renamedForRecent]);
	useEffect(() => {
		writeTabs(tabs);
	}, [tabs]);
	// What was closed, newest last, for ⌘⇧T to put back where it was. Not
	// kept across reloads: it is this sitting's changes of mind, not a record.
	// A note that went to the trash is not on it — there is nothing to reopen.
	const [closed, setClosed] = useState<Closed[]>([]);
	// Several at once, from the tab's menu, closed one after another as the row
	// stands at each step: each remembers its place then, which is where ⌘⇧T
	// puts it back, last closed first, and the row comes out as it was.
	const closeTabs = useCallback(
		(paths: string[]) => {
			let next = { tabs, active: open };
			const gone: Closed[] = [];
			for (const path of paths) {
				const at = next.tabs.indexOf(path);
				if (at === -1) continue;
				if (noteDeletedStore.get()?.path !== path) gone.push({ path, at });
				next = closeTabIn(next.tabs, path, next.active);
			}
			setTabs(next.tabs);
			if (gone.length) setClosed((stack) => [...stack, ...gone]);
			if (next.active !== open) showInstead(next.active);
		},
		[tabs, open, showInstead],
	);
	const closeTab = useCallback((path: string) => closeTabs([path]), [closeTabs]);
	const reopenTab = useCallback(() => {
		const last = closed[closed.length - 1];
		if (!last) return;
		setClosed(closed.slice(0, -1));
		setTabs((list) => reopen(list, last));
		setOpen(last.path);
	}, [closed, setOpen]);

	const [picking, setPicking] = useState(false);
	const [searching, setSearching] = useState(false);
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

	// A note in the trash keeps its tab while it is in front, and the column
	// under it offers to bring it back; opening something else, or closing the
	// tab, is the answer. Deleted behind another tab — from another window —
	// its tab just goes.
	const deleted = useSyncExternalStore(noteDeletedStore.subscribe, noteDeletedStore.get);
	useEffect(() => {
		if (deleted) setRecent((list) => forget(list, deleted.path));
	}, [deleted]);
	useEffect(() => {
		if (deleted && deleted.path !== open) closeTab(deleted.path);
	}, [deleted, open, closeTab]);

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
			// With Shift: ⌘F alone is the editor's, for the note in front.
			if ((e.key === "f" || e.key === "F") && e.shiftKey && mod) {
				e.preventDefault();
				setSearching((on) => !on);
			}
			if ((e.key === "d" || e.key === "D") && e.shiftKey && mod) {
				e.preventDefault();
				setRaw((on) => !on);
			}
			if (e.key === "\\" && mod) {
				e.preventDefault();
				togglePi();
			}
			// ⌘W closes the tab in front, as in a browser; with none left, the
			// window, as on a Mac. The shell's menu leaves the key to the page.
			if ((e.key === "w" || e.key === "W") && mod && !e.shiftKey) {
				e.preventDefault();
				if (open) closeTab(open);
				else if (tabs.length === 0) window.close();
			}
			if ((e.key === "t" || e.key === "T") && mod && e.shiftKey) {
				e.preventDefault();
				reopenTab();
			}
			// Back and forward through the notes you have been in, as in a browser
			// and in Obsidian. The editor leaves these two alone (Editor.tsx); its
			// default would indent with them, which Tab already does.
			if (mod && !e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
				e.preventDefault();
				if (e.code === "BracketLeft") back();
				else forward();
			}
			// Along the row: ⌃Tab as everywhere, ⌘⇧[ and ⌘⇧] as on a Mac. By code,
			// since with Shift the key on a Mac is } rather than ].
			const along = e.key === "Tab" && e.ctrlKey ? (e.shiftKey ? -1 : 1)
				: mod && e.shiftKey && e.code === "BracketRight" ? 1
				: mod && e.shiftKey && e.code === "BracketLeft" ? -1
				: 0;
			if (along) {
				e.preventDefault();
				const next = neighbour(tabs, open, along);
				if (next !== null && next !== open) setOpen(next);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [online, open, tabs, closeTab, reopenTab, setOpen, togglePi, back, forward]);

	// The side buttons of a mouse, which are back and forward everywhere else.
	// On mousedown, before the browser makes its own move with them.
	useEffect(() => {
		const onMouse = (e: MouseEvent) => {
			if (e.button !== 3 && e.button !== 4) return;
			e.preventDefault();
			if (e.button === 3) back();
			else forward();
		};
		window.addEventListener("mousedown", onMouse);
		return () => window.removeEventListener("mousedown", onMouse);
	}, [back, forward]);

	return (
		<TooltipProvider delayDuration={300}>
			<QuickOpen open={picking} onOpenChange={setPicking} recent={recent} onPick={setOpen} />
			<Search open={searching} onOpenChange={setSearching} onPick={setOpen} />
			<div className="flex h-screen flex-col">
			{/* Two rows, not three and not one: the window's controls over the
			    list, and the note tabs over everything else.

			    One row across the whole window could not know where the sidebar
			    ends — that boundary is the panel group's to compute, and a row
			    outside the group is only a sibling of it — so the tabs were
			    drawn over the list of notes, by a distance that changed every
			    time the sidebar was dragged. A row per column would have fixed
			    that and cut the tab row off at the note, which is narrower than
			    the tabs want. So the group is nested instead, and each row sits
			    inside the panel whose width it is allowed to have.

			    Both rows start at y=0: they are above the cards rather than in
			    them, and it was the cards' own margin that used to push them out
			    of line. The traffic lights keep the spot macOS pins them to,
			    16px down, the middle of a 44px row that begins at the top.

			    No lines under either. A row is frame and the card below it has a
			    rim of its own, so there is nothing for one to divide. */}
			<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" defaultLayout={columns.defaultLayout} onLayoutChanged={columns.onLayoutChanged}>
				<ResizablePanel id="sidebar" defaultSize="22%" minSize="16%" className="flex min-w-0 flex-col">
					{/* The traffic lights sit in this one, which is why it holds the
					    window's own controls and not the column's — and why the way
					    back is at the far end of it: the near end is theirs, and three
					    buttons are not to be crowded by a fourth. */}
					<div className="drag-region titlebar-inset flex h-11 shrink-0 items-center justify-end gap-0.5 px-2">
						<Steps back={back} forward={forward} canBack={canBack} canForward={canForward} />
					</div>
					<Boundary name="list of notes">
						<Sidebar open={open} onOpen={setOpen} />
					</Boundary>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="content" className="flex min-w-0 flex-col">
					<div className="drag-region flex h-11 shrink-0 items-center gap-0.5 px-2">
						<NoteTabs
							tabs={tabs}
							open={open}
							onOpen={setOpen}
							onClose={closeTab}
							onCloseMany={closeTabs}
							onReorder={(from, to) => setTabs((list) => move(list, from, to))}
							onNew={online ? () => send({ type: "new_note" }) : undefined}
						/>
						<PiToggle open={piOpen} onToggle={togglePi} />
					</div>
					{/* The card's own margin is the wrapper's to give. A group sets
					    width and height to 100% inline, so a margin on it is added to
					    that rather than taken out of it: the left one still pushes, the
					    right one goes over the edge and is clipped. Padding and a border
					    are fine — those are inside a border box.

					    No padding here, though. The rim is the only boundary left, and
					    what has to stay off it is the writing, which carries its own
					    inset already: 1.5rem in the editor's scroller, p-3 down pi's
					    side. A second one out here only stacked on those. */}
					<div className="min-h-0 flex-1 px-2 pb-2">
					<ResizablePanelGroup orientation="horizontal" className="overflow-hidden rounded-xl border bg-background" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
					<ResizablePanel id="main" minSize="30%" className="flex min-w-0 flex-col">
					{/* A different note is a different editor, with its own history,
					    rather than one editor with its text swapped — but a renamed note
					    is the same one, so the key is the note's identity, not its path. */}
					{/* The note is one page — its title, its text, what links here —
					    and the page (#note) is what scrolls, as in Obsidian: the editor
					    grows to its text and finds this scrolling parent on its own. Room
					    below, so the last line can be brought up to where the eyes are. */}
					{open && deleted?.path !== open ? (
						<div id="note" className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-[40vh]">
							{/* Inside the scroller, not around it: #note is what the editor,
							    the steps and the checks all look up, and it should be there
							    whether or not what it holds could be drawn. */}
							<Boundary name="note" hint="What you had typed was written to the file.">
								<Title path={open} />
								<Editor key={noteIdentity(open)} path={open} place={place} left={left} onLeave={onLeave} onOpen={setOpen} />
							</Boundary>
						</div>
					) : (
						<div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
							{deleted && deleted.path === open ? (
								<>
									<span>
										Deleted <span className="text-foreground">{deleted.path.replace(/\.md$/, "")}</span>
									</span>
									{deleted.to === "vault" ? (
										<Button
											variant="outline"
											size="sm"
											className="h-7 text-xs"
											onClick={() => send({ type: "restore_note", trashed: deleted.trashed, path: deleted.path })}
										>
											Restore
										</Button>
									) : (
										/* The machine's trash is not ours to reach into — a trash takes things and does
										   not hand them back — and it does not need to be: the Finder put it there and
										   Put Back brings it home, long after this row has gone. */
										<span className="text-xs">In the Trash · Put Back in the Finder brings it here with its history</span>
									)}
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
						className="flex min-w-0 flex-col"
						onResize={() => setPiOpen(!pi.current?.isCollapsed())}
					>
						{/* No fill and no edge: the note stops and the conversation
						    starts, and eight pixels of the card is all that is between
						    them. Three floors were tried side by side — the window's own
						    colour, a rung above the note, and nothing — and nothing read
						    best. One card, and pi opening inside it. */}
						<div className="ml-2 flex min-h-0 flex-1 flex-col overflow-hidden">
							<Boundary name="conversation">
								<Pi note={open} raw={raw} />
							</Boundary>
						</div>
					</ResizablePanel>
					</ResizablePanelGroup>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
			</div>
		</TooltipProvider>
	);
}
