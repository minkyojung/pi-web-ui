import { useEffect, useSyncExternalStore } from "react";

import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon, FileTextIcon, FolderIcon } from "lucide-react";

import { titleOf } from "../noteSync";
import { filesStore, filesTruncatedStore } from "../serverState";
import { type Node, openFoldersStore, reveal, setOpenFolders, toggle, treeOf } from "../tree";
import { FolderPicker } from "./FolderPicker";
import { noteActions } from "../noteActions";
import { getConnection, subscribe } from "../store";
import { Settings } from "./Settings";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The left column: the notes in the folder pi works in, as a tree of its
 * folders.
 *
 * The list comes from the server, which re-sends it after every write, so a
 * note pi just wrote is on it without anyone asking. A row opens its note in
 * the middle column, by way of the address.
 *
 * The tree is the shadcn sidebar's file tree — a Collapsible for a folder, a
 * button for a note, the same again inside — drawn with the app's own button
 * rather than the sidebar kit's, whose provider would want to own the
 * column's width and the window's top edge, both already spoken for. Which
 * folders stand open is kept outside React: the list is re-sent after every
 * write, and a folder should not fold because pi saved a note.
 *
 * It has no header. The row the traffic lights sit in belongs to the window
 * and is drawn there (App.tsx), across the whole of it, which is where Linear
 * puts its own — measured, that strip runs the full width and the sidebar
 * under it is one unbroken surface. A column that kept a header of its own
 * would need a line under it to say where the header ended, and that line is
 * the thing being got rid of.
 *
 * The foot of the column is what is true of the whole window: which folder
 * this is, and the settings — away from the notes and the moving about, since
 * neither is about anything in the list. Obsidian keeps its vault there and
 * Linear, Slack and VS Code all keep their settings there.
 *
 * It paints in the sidebar tokens, not the page's. Every theme sets the column
 * a step off the page it sits beside — that is what the tokens are for — and a
 * column drawn in --background has no way to say it.
 */
export function Sidebar({
	open,
	onOpen,
}: {
	open: string | null;
	onOpen: (path: string) => void;
}) {
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
	const truncated = useSyncExternalStore(filesTruncatedStore.subscribe, filesTruncatedStore.get);
	const openFolders = useSyncExternalStore(openFoldersStore.subscribe, openFoldersStore.get);

	// The open note is in view: its folders open as it is opened, or as it is
	// renamed into one. They stay open until closed by hand.
	useEffect(() => {
		if (open) setOpenFolders(reveal(openFoldersStore.get(), open));
	}, [open]);

	return (
		<nav className="flex min-h-0 flex-1 flex-col text-sidebar-foreground">
			{files.length === 0 ? (
				<div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
					No notes in this folder yet
				</div>
			) : (
				// The rows are inset by the same gutter the foot keeps, so a row's
				// highlight ends where the settings button does.
				<ul id="notes" className="no-scrollbar edge-bottom [--edge-over:var(--sidebar)] flex-1 overflow-y-auto overscroll-contain px-2 py-1">
					{treeOf(files.map((f) => f.path)).map((node) => (
						<Tree key={node.path} node={node} open={open} openFolders={openFolders} onOpen={onOpen} />
					))}
					{/* A note that is in the folder and in no list would be missing from
					    here and from a search of every note, with nothing to say why. */}
					{truncated && (
						<li id="truncated" className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
							This folder holds more notes than the list takes. The rest are not here, or in a search.
						</li>
					)}
				</ul>
			)}
			{/* Not a drag region: the foot of the window is not its title bar. */}
			<div className="flex h-10 shrink-0 items-center gap-1 px-2">
				<FolderPicker />
				<Settings />
			</div>
		</nav>
	);
}

/**
 * The way back through the notes you have been in, and forward again.
 *
 * Lit only while there is somewhere to go — which is the one thing the
 * browser's own list cannot be asked, and half the reason the app keeps its
 * own (nav.ts).
 */
export function Steps({ back, forward, canBack, canForward }: { back: () => void; forward: () => void; canBack: boolean; canForward: boolean }) {
	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button id="back" variant="ghost" size="icon-xs" aria-label="Back" className="shrink-0 text-muted-foreground" disabled={!canBack} onClick={back}>
						<ChevronLeftIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">Back ⌘[</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button id="forward" variant="ghost" size="icon-xs" aria-label="Forward" className="shrink-0 text-muted-foreground" disabled={!canForward} onClick={forward}>
						<ChevronRightIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">Forward ⌘]</TooltipContent>
			</Tooltip>
		</>
	);
}

const row = cn(
	"h-8 w-full cursor-default justify-start px-2 font-normal",
	// The dark hover ghost carries is the page's accent at half alpha, under a
	// modifier tailwind-merge cannot line up with the one above it, so it is
	// named again here.
	"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent",
	// Inside the row: the list scrolls, and a ring drawn outside the top row
	// would be cut off by the edge it scrolls under.
	"focus-visible:ring-sidebar-ring/50 focus-visible:ring-inset",
);

function Tree({
	node,
	open,
	openFolders,
	onOpen,
}: {
	node: Node;
	open: string | null;
	openFolders: ReadonlySet<string>;
	onOpen: (path: string) => void;
}) {
	// Nothing goes to the server while the socket is down, and an item that
	// still looked live would silently do nothing.
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	if (node.kind === "file") {
		const active = node.path === open;
		return (
			<li>
				{/* The same things the header's ⋯ offers, from a right click here —
				    a list you cannot act on is a list you have to open everything
				    in. The menu wraps the tooltip rather than the other way round:
				    both want the row, and only one of them can be asChild of it. */}
				<ContextMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<ContextMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							data-path={node.path}
							data-active={active}
							aria-current={active ? "page" : undefined}
							onClick={() => onOpen(node.path)}
							className={cn(
								row,
								// Weight, not only colour — the open note and the one under
								// the pointer are the same surface, and something has to tell
								// them apart while the pointer is somewhere else.
								"data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
							)}
						>
							<FileTextIcon className="text-muted-foreground" />
							<span className="truncate">{titleOf(node.path)}</span>
						</Button>
						</ContextMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="right">{node.path}</TooltipContent>
				</Tooltip>
				<ContextMenuContent>
					{noteActions(node.path).map((action, i) =>
						action === "separator" ? (
							<ContextMenuSeparator key={i} />
						) : (
							<ContextMenuItem
								key={action.label}
								variant={action.destructive ? "destructive" : undefined}
								disabled={action.needsServer && !online}
								onSelect={action.run}
							>
								{action.label}
							</ContextMenuItem>
						),
					)}
				</ContextMenuContent>
				</ContextMenu>
			</li>
		);
	}

	return (
		<li>
			<Collapsible
				open={openFolders.has(node.path)}
				onOpenChange={() => setOpenFolders(toggle(openFoldersStore.get(), node.path))}
				className="[&[data-state=open]>button>svg:first-child]:rotate-90"
			>
				<CollapsibleTrigger asChild>
					<Button variant="ghost" size="sm" data-folder={node.path} className={row}>
						<ChevronRightIcon className="text-muted-foreground transition-transform" />
						<FolderIcon className="text-muted-foreground" />
						<span className="truncate">{node.name}</span>
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent asChild>
					{/* The shadcn sidebar's sub-menu: a line down the left, the rows inset past it. */}
					<ul className="mx-3.5 flex translate-x-px flex-col border-l border-sidebar-border pl-2.5">
						{node.children.map((child) => (
							<Tree key={child.path} node={child} open={open} openFolders={openFolders} onOpen={onOpen} />
						))}
					</ul>
				</CollapsibleContent>
			</Collapsible>
		</li>
	);
}
