import { useEffect, useSyncExternalStore } from "react";

import { cn } from "cn";
import { ChevronRightIcon, FileTextIcon, FolderIcon } from "lucide-react";

import { titleOf } from "../noteSync";
import { filesStore } from "../serverState";
import { type Node, openFoldersStore, reveal, setOpenFolders, toggle, treeOf } from "../tree";
import { Settings } from "./Settings";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
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
 * Its header is the window's own top-left corner: the traffic lights sit in
 * that row, which is why it has a fixed height rather than one its contents
 * decide. The settings live there because they are about the window and the
 * agent, not about anything in the column below.
 *
 * It paints in the sidebar tokens, not the page's. Every theme sets the column
 * a step off the page it sits beside — that is what the tokens are for — and a
 * column drawn in --background has no way to say it.
 */
export function Sidebar({ open, onOpen }: { open: string | null; onOpen: (path: string) => void }) {
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
	const openFolders = useSyncExternalStore(openFoldersStore.subscribe, openFoldersStore.get);

	// The open note is in view: its folders open as it is opened, or as it is
	// renamed into one. They stay open until closed by hand.
	useEffect(() => {
		if (open) setOpenFolders(reveal(openFoldersStore.get(), open));
	}, [open]);

	return (
		<nav className="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
			<div className="drag-region titlebar-inset flex h-11 shrink-0 items-center justify-end border-b border-sidebar-border px-2">
				<Settings />
			</div>
			{files.length === 0 ? (
				<div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
					No notes in this folder yet
				</div>
			) : (
				// The rows are inset by the gutter the header keeps, so a row's
				// highlight ends where the settings button does.
				<ul id="notes" className="no-scrollbar flex-1 overflow-y-auto overscroll-contain px-2 py-1">
					{treeOf(files.map((f) => f.path)).map((node) => (
						<Tree key={node.path} node={node} open={open} openFolders={openFolders} onOpen={onOpen} />
					))}
				</ul>
			)}
		</nav>
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
	if (node.kind === "file") {
		const active = node.path === open;
		return (
			<li>
				<Tooltip>
					<TooltipTrigger asChild>
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
					</TooltipTrigger>
					<TooltipContent side="right">{node.path}</TooltipContent>
				</Tooltip>
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
