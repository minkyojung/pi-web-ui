import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon, FileIcon, FileTextIcon, FolderIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { titleOf } from "../noteSync";
import { isDocument } from "../../../documentKinds.ts";
import { configStore, documentsStore, filesStore, filesTruncatedStore } from "../serverState";
import { type Node, openFoldersStore, reveal, setOpenFolders, toggle, treeOf } from "../tree";
import { noteActions } from "../noteActions";
import { getConnection, subscribe } from "../store";
import { CloneRepository } from "./CloneRepository";
import { Settings } from "./Settings";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The left column. In the app, the repositories and their workspaces (see
 * Workspaces below); where there is no shell to keep that list, the notes in
 * the folder pi works in, as a tree of its folders.
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
 * The foot of the column is what is true of the whole window: the settings —
 * away from the list, since they are about nothing in it. Linear, Slack and
 * VS Code all keep their settings there.
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
	// The documents in the folder — PDFs — sit in the tree where they are on
	// disk, among the notes: the tree answers "where is it", of any file that opens.
	const documents = useSyncExternalStore(documentsStore.subscribe, documentsStore.get);
	const truncated = useSyncExternalStore(filesTruncatedStore.subscribe, filesTruncatedStore.get);
	const openFolders = useSyncExternalStore(openFoldersStore.subscribe, openFoldersStore.get);
	const workspaces = useWorkspaceList();

	// The open note is in view: its folders open as it is opened, or as it is
	// renamed into one. They stay open until closed by hand.
	useEffect(() => {
		if (open) setOpenFolders(reveal(openFoldersStore.get(), open));
	}, [open]);

	return (
		<nav className="flex min-h-0 flex-1 flex-col text-sidebar-foreground">
			{/* In the app the column is the repositories and their workspaces, and
			    the notes are not listed — Octave works in code now, and a tree of
			    a repository's markdown alone is not a view of it. Where there is
			    no shell to keep that list, the notes are what there is to show. */}
			{workspaces !== null ? (
				// Until the shell answers, the room it will take, so the foot stays put.
				workspaces ? <Workspaces list={workspaces} /> : <div className="flex-1" />
			) : files.length === 0 ? (
				<div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
					No notes in this folder yet
				</div>
			) : (
				// The rows are inset by the same gutter the foot keeps, so a row's
				// highlight ends where the settings button does.
				<ul id="notes" className="no-scrollbar flex-1 overflow-y-auto overscroll-contain px-2 py-1">
					{treeOf([...files.map((f) => f.path), ...documents]).map((node) => (
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
			{/* Not a drag region: the foot of the window is not its title bar.

			    One of the window's chrome rows, and the same height as the rest of
			    them — the strip the tabs sit in, the strip over this list, the one
			    under the note (StatusBar.tsx). Nothing in it names a height of its
			    own: the buttons are shadcn's at `sm`, and the gap to the edge of the
			    row is what is left over. Two rows along one edge that did not agree
			    read as one row that is crooked, and heights matched by eye drift the
			    moment either end is touched. */}
			<div id="foot" className="flex h-11 shrink-0 items-center justify-end gap-1 px-2">
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
	// A row at rest is second-rank text; the pointer and the open note raise it
	// to first. Twenty notes all at the window's brightest is twenty notes
	// shouting, and the one you are in has only its background left to say so.
	// The step is the one the window already declares — Apple's secondaryLabel,
	// Radix's step 11, Linear's tertiary — not a colour invented for this
	// column. --muted-foreground is held against the darkest surface it lands
	// on, --sidebar-accent among them, so it clears AA on both the column and a
	// hovered row in all four themes (4.65 at the tightest).
	"text-muted-foreground",
	// The dark hover ghost carries is the page's accent at half alpha, under a
	// modifier tailwind-merge cannot line up with the one above it, so it is
	// named again here.
	"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent",
	// Inside the row: the list scrolls, and a ring drawn outside the top row
	// would be cut off by the edge it scrolls under.
	"focus-visible:ring-sidebar-ring/50 focus-visible:ring-inset",
);

/** The list the shell keeps — see electron/workspaces.js and preload.cjs. */
interface WorkspaceList {
	current: string | null;
	projects: { path: string; name: string; worktrees: { path: string; name: string; branch: string }[] }[];
}

/** The shell's side of the list, absent in a browser tab. */
const workspaceShell = (
	window as {
		pi?: {
			workspaces?: {
				list(): Promise<WorkspaceList | null>;
				create(root: string): Promise<string | null>;
				open(path: string): Promise<void>;
				onChange(listen: () => void): () => void;
			};
		};
	}
).pi?.workspaces;

/** The shell's way to add a repository from the Finder — see preload.cjs `repositories`. */
const openLocal = (window as { pi?: { repositories?: { openLocal(): Promise<{ error?: string } | null> } } }).pi?.repositories?.openLocal;

/**
 * What a workspace's row says: its branch, less the owner every branch here
 * starts with — `minkyojung/email-auth` is `email-auth` in a list of the
 * same person's work. The whole of it is the row's tooltip.
 */
const branchName = (branch: string) => branch.slice(branch.indexOf("/") + 1);

/**
 * The repositories and their workspaces, as Conductor lists them: a row for
 * the repository that folds, a + on it for a new workspace, and under it a
 * row for each workspace, named by its branch. The shell keeps the list and
 * does the moving — the page asks, and the window is put on the workspace
 * chosen. In a browser tab, or a dev run, there is no shell to ask, and
 * nothing is drawn.
 */
/**
 * The shell's list, kept up: `undefined` until the shell has answered, then
 * the list, or null where there is none — a browser tab, a dev run.
 */
function useWorkspaceList(): WorkspaceList | null | undefined {
	const [list, setList] = useState<WorkspaceList | null | undefined>(workspaceShell ? undefined : null);
	/** The one way to ask, held where the turn below can reach it too. */
	const ask = useRef<() => void>(() => {});
	useEffect(() => {
		if (!workspaceShell) return;
		let live = true;
		const load = () => {
			workspaceShell.list().then(
				(next) => live && setList(next),
				() => live && setList((was) => was ?? null),
			);
		};
		ask.current = load;
		load();
		const stop = workspaceShell.onChange(load);
		// A branch renamed inside a workspace — by hand, in a terminal — is news
		// only git has, so the list is asked again when the window comes back.
		window.addEventListener("focus", load);
		return () => {
			live = false;
			stop();
			window.removeEventListener("focus", load);
		};
	}, []);
	// And the moment a turn ends, which is the other time it changes: the turn
	// that names a spec renames the branch after it (spec.ts), so a row that
	// said `bangkok` says `email-auth` as the answer arrives rather than the
	// next time the window is clicked away from and back to.
	//
	// Not a race with that rename: pi awaits its extensions' agent_settled
	// before it emits the one the server turns into this (agent-session.ts),
	// so by the time a turn reads as ended here, git has the new name.
	const streaming = useSyncExternalStore(configStore.subscribe, () => configStore.get()?.isStreaming ?? false);
	const before = useRef(streaming);
	useEffect(() => {
		const was = before.current;
		before.current = streaming;
		if (was && !streaming) ask.current();
	}, [streaming]);
	return list;
}

function Workspaces({ list }: { list: WorkspaceList }) {
	const [making, setMaking] = useState<string | null>(null);
	const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
	const [cloning, setCloning] = useState(false);
	const shell = workspaceShell!;

	// Adding one moves the window into it; what is left to say here is why not.
	const addLocal = () => {
		openLocal?.().then(
			(result) => result?.error && toast.error(result.error),
			(err: Error) => toast.error(err.message),
		);
	};

	const make = (root: string) => {
		setMaking(root);
		shell.create(root).finally(() => setMaking(null));
	};
	const fold = (root: string) =>
		setFolded((was) => {
			const next = new Set(was);
			if (!next.delete(root)) next.add(root);
			return next;
		});

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* shadcn's sidebar group: a label, and the group's one action beside it —
			    centred over each repository's own +, which is a size larger. */}
			<div className="flex h-8 shrink-0 items-center justify-between pr-3 pl-4">
				<span className="text-xs font-medium text-muted-foreground">Repositories</span>
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button id="add-repository" variant="ghost" size="icon-xs" aria-label="Add a repository" className="text-muted-foreground">
									<PlusIcon />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent side="right">Add a repository</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="start" side="right">
						<DropdownMenuItem onSelect={addLocal}>Open local repository…</DropdownMenuItem>
						{/* The menu is let go of first, so the dialog is not opened behind it. */}
						<DropdownMenuItem id="clone-github" onSelect={() => queueMicrotask(() => setCloning(true))}>
							Clone from GitHub…
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<CloneRepository open={cloning} onOpenChange={setCloning} />
			<ul id="workspaces" className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-1">
				{list.projects.map((project) => (
					<li key={project.path}>
						<Collapsible open={!folded.has(project.path)} onOpenChange={() => fold(project.path)} className="group/repo">
							<div className="flex items-center gap-0.5">
								<CollapsibleTrigger asChild>
									<Button variant="ghost" size="sm" data-repo={project.path} className={cn(row, "min-w-0 flex-1 font-medium text-sidebar-foreground")}>
										<ChevronRightIcon className="transition-transform group-data-[state=open]/repo:rotate-90" />
										<span className="truncate">{project.name}</span>
									</Button>
								</CollapsibleTrigger>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon-sm"
											data-new-workspace={project.path}
											aria-label={`New workspace in ${project.name}`}
											disabled={making !== null}
											onClick={() => make(project.path)}
											className="shrink-0 text-muted-foreground"
										>
											{making === project.path ? <Spinner /> : <PlusIcon />}
										</Button>
									</TooltipTrigger>
									<TooltipContent side="right">New workspace</TooltipContent>
								</Tooltip>
							</div>
							<CollapsibleContent asChild>
								<ul className="flex flex-col pl-3">
									{project.worktrees.map((worktree) => {
										const active = worktree.path === list.current;
										return (
											<li key={worktree.path}>
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="sm"
															data-workspace={worktree.path}
															data-active={active}
															aria-current={active ? "page" : undefined}
															onClick={() => !active && shell.open(worktree.path)}
															className={cn(
																row,
																"data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
															)}
														>
															<GitBranchIcon />
															<span className="truncate">{branchName(worktree.branch)}</span>
														</Button>
													</TooltipTrigger>
													<TooltipContent side="right">{worktree.branch}</TooltipContent>
												</Tooltip>
											</li>
										);
									})}
								</ul>
							</CollapsibleContent>
						</Collapsible>
					</li>
				))}
			</ul>
		</div>
	);
}

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
							{/* The icon takes the row's colour, so it is raised with the
							    label rather than left behind at second rank. */}
							{/* A document keeps its extension, and a plainer sheet: the row
							    says it is not a note before it is opened. */}
							{isDocument(node.path) ? <FileIcon /> : <FileTextIcon />}
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
						<ChevronRightIcon className="transition-transform" />
						<FolderIcon />
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
