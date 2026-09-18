import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type PanelImperativeHandle, useDefaultLayout } from "react-resizable-panels";

import { Editor } from "./components/Editor";
import { Pi } from "./components/Pi";
import { PiToggle, SidebarToggle } from "./components/PanelHeader";
import { Sidebar, Steps } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { QuickOpen } from "./components/QuickOpen";
import { Search } from "./components/Search";
import { WhyCard } from "./components/WhyCard";
import { Title } from "./components/Title";
import { Boundary } from "./components/Boundary";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { UpdateToast } from "./components/UpdateToast";
import type { Place } from "../../links.ts";
import { hashForNote, noteFromHash } from "./noteSync";
import { pageOf, WELCOME, whatsNewPath } from "./pages";
import { pageAskedStore, updateStore } from "./update";
import { Welcome } from "./components/Welcome";
import { WhatsNew } from "./components/WhatsNew";
import { NoteHeader } from "./components/NoteHeader";
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
 * The width of the strip along the top, kept the way the columns' own widths
 * are. A folded column is none wide and the layout remembers it as none, so
 * without this a window opened folded would have nothing to set the strip by
 * and would gather the buttons at its edge.
 */
const RAIL = "strip-width";

/** The list's share of the window before anyone has dragged it. */
const SIDEBAR = "22%";

function readRail(): number | null {
	try {
		const kept = Number(localStorage.getItem(RAIL));
		return kept > 0 ? kept : null;
	} catch {
		return null;
	}
}

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
	// And how wide it is, which the strip along the foot lays its own pi half
	// out to. The panel reports it in pixels on every change, the window's own
	// included, so the two stay together while the divider is being dragged.
	const [piWidth, setPiWidth] = useState<number | null>(null);
	// The columns' widths, and whether pi is folded away, outlive the window:
	// the shadcn sidebar keeps its open state in a cookie for the same reason.
	// Two groups, because the window divides twice and the divisions are not
	// peers: the sidebar is cut off from everything else, and what is left is
	// cut again into the note and pi. Each keeps its own widths.
	const columns = useDefaultLayout({ id: "columns", storage: localStorage, panelIds: ["sidebar", "content"] });
	const panes = useDefaultLayout({ id: "panes", storage: localStorage, panelIds: ["main", "pi"] });
	// Opening only, for the folded ring at the foot of the window: it is only
	// ever pressed with the column away, and a press that could also fold it
	// would be a guess about which way the column was.
	const unfoldPi = useCallback(() => pi.current?.expand(), []);
	const togglePi = useCallback(() => {
		const panel = pi.current;
		if (panel) panel.isCollapsed() ? panel.expand() : panel.collapse();
	}, []);
	const sidebar = useRef<PanelImperativeHandle>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	// The strip along the top of the window is as wide as the column under it,
	// so the way back stays at the edge it has always been at — including while
	// that edge is being dragged. A folded column is none wide and would take
	// the buttons to the window's edge with it, so the strip keeps the last
	// width the column had rather than following it to nothing.
	const [railWidth, setRailWidth] = useState<number | null>(readRail);
	useEffect(() => {
		if (railWidth === null) return;
		try {
			localStorage.setItem(RAIL, String(railWidth));
		} catch {
			// A window with storage blocked forgets, which is all that is lost.
		}
	}, [railWidth]);
	// The width is said outright rather than left to expand(). The panel answers
	// isCollapsed() on a comparison rounded to three places and acts on expand()
	// only when its size is exactly the folded one, so a size that rounds to
	// folded without being it reads as folded and refuses to open — the column
	// would be shut for good. Saying the width asks nothing of that pair, and it
	// restores the width the column had: expand() knows only the width it was
	// folded from, which a window opened folded was never told.
	const toggleSidebar = useCallback(() => {
		const panel = sidebar.current;
		if (!panel) return;
		if (panel.isCollapsed()) panel.resize(railWidth === null ? SIDEBAR : `${railWidth}px`);
		else panel.collapse();
	}, [railWidth]);
	// How wide the strip came out. With the list folded it is as wide as the
	// controls on it and no wider, which is not a number anything here knows —
	// so it is measured rather than worked out, and the tabs stand off by it.
	const strip = useRef<HTMLDivElement>(null);
	const [stripWidth, setStripWidth] = useState<number | null>(null);
	useEffect(() => {
		const el = strip.current;
		if (!el) return;
		const watch = new ResizeObserver(() => setStripWidth(el.offsetWidth));
		watch.observe(el);
		return () => watch.disconnect();
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
	// A page in front: the middle column is its, and what reads the address as
	// a note — the crumbs, the sidebar's open folders, the strip, the agent's
	// idea of which note is open — is told there is none.
	const page = pageOf(open);
	const note = page ? null : open;

	// What is new, on the first run of a version (the shell says so, once, until
	// it is told it has been seen) and whenever Help asks.
	const update = useSyncExternalStore(updateStore.subscribe, updateStore.get);
	const pageAsked = useSyncExternalStore(pageAskedStore.subscribe, pageAskedStore.get);
	useEffect(() => {
		if (update?.justUpdated) setOpen(whatsNewPath(update.justUpdated.to));
	}, [update?.justUpdated?.to, setOpen]);
	useEffect(() => {
		if (!pageAsked || !update) return;
		pageAskedStore.set(null);
		if (pageAsked === "whats-new") setOpen(whatsNewPath(update.current));
		if (pageAsked === "welcome") setOpen(WELCOME);
	}, [pageAsked, update, setOpen]);
	// The first run: the welcome page in front, until Done is pressed on it.
	const welcomedOnce = useRef(false);
	useEffect(() => {
		if (welcomedOnce.current || update?.welcomed !== false) return;
		welcomedOnce.current = true;
		setOpen(WELCOME);
	}, [update?.welcomed, setOpen]);

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
			// The list of notes, as in VS Code, Notion and Obsidian.
			if ((e.key === "b" || e.key === "B") && mod && !e.shiftKey) {
				e.preventDefault();
				toggleSidebar();
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
	}, [online, open, tabs, closeTab, reopenTab, setOpen, togglePi, toggleSidebar, back, forward]);

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
			{/* Beside the words it is about, when one of them has been asked about. */}
			<WhyCard />
			{/* The corner: the one place something not about the note or the agent may speak up. */}
			<Toaster position="bottom-right" offset={{ bottom: 44, right: 16 }} />
			<UpdateToast />
			<div className="relative flex h-screen flex-col">
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
			{/* The traffic lights sit in this one, which is why it holds the window's
			    own controls and not the column's — and why the way back is at the far
			    end of it: the near end is theirs, and three buttons are not to be
			    crowded by a fourth. The fold is the exception, since it is the one
			    control the traffic lights are a row of.

			    Out here rather than in the column, because a button that folds the
			    column away cannot be inside it: it would go with it and leave nothing
			    to bring it back. So the strip is laid over the group instead, as wide
			    as the column below it, and the column keeps a gap the height of it. */}
			<div
				ref={strip}
				className="drag-region titlebar-inset absolute top-0 left-0 z-20 flex h-11 items-center gap-0.5 px-2"
				style={{ width: sidebarOpen ? (railWidth ?? undefined) : undefined }}
			>
				<SidebarToggle open={sidebarOpen} onToggle={toggleSidebar} />
				{/* The way back sits at the column's far edge while there is a column
				    to have an edge. Folded, there is no edge to hold it out there and
				    the gap would be a hole, so the controls close up together. */}
				{sidebarOpen && <div className="flex-1" />}
				<Steps back={back} forward={forward} canBack={canBack} canForward={canForward} />
			</div>
			<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" defaultLayout={columns.defaultLayout} onLayoutChanged={columns.onLayoutChanged}>
				<ResizablePanel
					id="sidebar"
					panelRef={sidebar}
					defaultSize={SIDEBAR}
					minSize="16%"
					collapsible
					collapsedSize="0%"
					className="flex min-w-0 flex-col"
					onResize={(size) => {
						setSidebarOpen(!sidebar.current?.isCollapsed());
						if (size.inPixels > 0) setRailWidth(size.inPixels);
					}}
				>
					{/* The strip's own height, kept for it: it is laid over this column
					    rather than in it, and the list begins below it. */}
					<div className="h-11 shrink-0" />
					<Boundary name="list of notes">
						<Sidebar open={note} onOpen={setOpen} />
					</Boundary>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel id="content" className="flex min-w-0 flex-col">
					{/* With the list folded away this column begins at the window's
					    edge, under the strip. The tabs start clear of it: the strip is
					    the one thing that does not move when the fold does.

					    A margin rather than padding, because this is a drag region and
					    the shell reads those as boxes. Padding moves the tabs but leaves
					    the box on the window's edge, over the strip — and a drag region
					    later in the document fills in the holes an earlier one punched
					    for its buttons, so the fold button under it stopped answering
					    the mouse while the keyboard still reached it. */}
					<div
						className="drag-region flex h-11 shrink-0 items-center gap-0.5 pr-2"
						style={sidebarOpen ? undefined : { marginLeft: stripWidth ?? railWidth ?? undefined }}
					>
						<NoteTabs
							tabs={tabs}
							open={open}
							onOpen={setOpen}
							onClose={closeTab}
							onCloseMany={closeTabs}
							onReorder={(from, to) => setTabs((list) => move(list, from, to))}
							onNew={online ? () => send({ type: "new_note" }) : undefined}
						/>
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
					{/* The left gap is the list's to give, and with it folded away there
					    is nobody to give it: the card would sit on the window's own
					    edge, where the sides keep eight pixels off it.

					    No gap under it. The strip below is the card's bottom boundary,
					    the way a status bar is the boundary under an editor: eight
					    pixels there sat above the strip rather than under the card, so
					    what was in the strip had fourteen pixels over it and six under
					    and read as hung too low. The strip's own inset is the only gap
					    on either side of it now. */}
					<div className={`flex min-h-0 flex-1 flex-col pr-2 ${sidebarOpen ? "" : "pl-2"}`}>
					<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
					<ResizablePanel id="main" minSize="30%" className="flex min-w-0 flex-col">
					<NoteHeader path={note} onOpen={setOpen} trailing={<PiToggle open={piOpen} onToggle={togglePi} />} />
					{/* A different note is a different editor, with its own history,
					    rather than one editor with its text swapped — but a renamed note
					    is the same one, so the key is the note's identity, not its path. */}
					{/* The note is one page — its title, its text, what links here —
					    and the page (#note) is what scrolls, as in Obsidian: the editor
					    grows to its text and finds this scrolling parent on its own.

					    A column, so the page has a foot for the editor to reach: the
					    editor takes whatever the title and the links leave, and a note
					    of three lines is still a page you can click the bottom of.

					    There used to be 40vh of padding here, to leave room to bring
					    the last line up to where the eyes are. Room below the text and
					    what the vault knows sitting at the foot of the page cannot both
					    be had, and the room was the one to go: a note short enough for
					    this to matter is a note that does not scroll, and room to scroll
					    into is nothing to a page that has nowhere to go. */}
					{page?.kind === "welcome" ? (
						<Welcome onDone={() => closeTab(WELCOME)} />
					) : page ? (
						<WhatsNew key={page.version} version={page.version} />
					) : open && deleted?.path !== open ? (
						<div id="note" className="no-scrollbar edge-top flex min-h-0 flex-1 flex-col overflow-y-auto">
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
									<p className="mt-2">⌘N makes one. The agent reads and writes the same files; who wrote which words is kept beside them, in .pi/.</p>
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
						onResize={(size) => {
							setPiOpen(!pi.current?.isCollapsed());
							setPiWidth(size.inPixels);
						}}
					>
						{/* A floor of its own, laid inside the card rather than up
						    against it: the note is the page, the conversation beside it
						    is not the same page, and --panel steps off the note — up in
						    a dark window, down in a light one, the same distance either
						    way. The eight pixels all round are what the two surfaces are
						    read against: the note's page runs behind pi on every side,
						    so the panel is a thing on the page and not the other half of
						    it, and no line has to be drawn to say so.

						    The corner is the card's own less the gap — 14px round the
						    outside, 8px of page, 6px here — which is what keeps two
						    curves this close from reading as a mistake. Tailwind has
						    that number already: --radius-sm is --radius-xl less 8.

						    And --border round it, the token every other rim in the
						    window uses. It is a rim on a surface rather than a line
						    between two, which is the one job that token has: in the
						    dark themes it is white at 5%, so it lands the same 0.047
						    off pi's floor that the card's rim lands off the page, and
						    in the light ones it is fainter against pi than against the
						    card — which is what is wanted, since a floor that is already
						    a step down does not need saying twice. */}
						<div className="surface-panel m-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border">
							<Boundary name="conversation">
								<Pi note={note} raw={raw} />
							</Boundary>
						</div>
					</ResizablePanel>
					</ResizablePanelGroup>
					</div>
					{/* Under the card rather than across the whole window: what it has
					    to say is about the note, and the list of notes down the left is
					    not about the note. The card and pi give up its height together,
					    the way the two columns keep the tabs' strip clear at the top.

					    Outside the card's wrapper, and so down on the window's own edge.
					    Inside it, the wrapper's eight pixels lay under the strip rather
					    than under the card, and what looked like the foot of the window
					    was a 28px strip with 8px of nothing beneath it: everything in it
					    sat centred in the strip and high in the foot. A status bar is
					    part of the window and reaches its edge, as VS Code's and Zed's
					    do, and then there is only one place for anything to be centred
					    in. */}
					<StatusBar path={note} piWidth={piWidth} piFolded={!piOpen} onUnfoldPi={unfoldPi} />
				</ResizablePanel>
			</ResizablePanelGroup>
			</div>
		</TooltipProvider>
	);
}
