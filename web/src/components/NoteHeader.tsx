import { useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis, FileTextIcon, FolderIcon, LockIcon, MoreHorizontal, SquareArrowOutUpRightIcon } from "lucide-react";

import { toast } from "sonner";

import { inFrontStore } from "../inFront";
import { noteActions } from "../noteActions";
import { isCode } from "../pages";
import { titleOf, wholePath } from "../noteSync";
import { configStore, documentsStore, filesStore, repoStore } from "../serverState";
import { childrenOf, foldersOf, openFoldersStore, setOpenFolders } from "../tree";
import { getConnection, subscribe } from "../store";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** An editor this machine has, as the shell reports it (electron/editors.js). */
type Editor = { scheme: string; name: string; icon: string | null };

/** The shell's bridge, absent in a browser tab: a page cannot start an app. */
const shell = (window as { pi?: { editors: { list(): Promise<Editor[] | null>; open(scheme: string, file: string, line: number): Promise<{ error?: string }> }; reveal(path: string): Promise<void> } }).pi;

/** Open a folder in the sidebar and bring it into view, without closing anything. */
function show(folder: string) {
	const open = openFoldersStore.get();
	// Its own ancestors too: a folder cannot be seen while the one above it is shut.
	setOpenFolders(new Set([...open, ...foldersOf(folder), folder]));
	// After the column has redrawn with it standing open.
	requestAnimationFrame(() => {
		document.querySelector(`#notes [data-folder="${CSS.escape(folder)}"]`)?.scrollIntoView({ block: "nearest" });
	});
}

/** How much of a deep path the crumb line spells out before folding the middle away. */
const CRUMB_HEAD = 1;
const CRUMB_TAIL = 1;

/** `folders`, split into what stays at each end and what collapses behind `…`. */
function splitCrumbs(folders: string[]): { head: string[]; hidden: string[]; tail: string[] } {
	if (folders.length <= CRUMB_HEAD + CRUMB_TAIL) return { head: [], hidden: [], tail: folders };
	return {
		head: folders.slice(0, CRUMB_HEAD),
		hidden: folders.slice(CRUMB_HEAD, folders.length - CRUMB_TAIL),
		tail: folders.slice(folders.length - CRUMB_TAIL),
	};
}

/** The leaf of a path: the folder's own name, without the folders above it. */
const nameOf = (folder: string) => folder.slice(folder.lastIndexOf("/") + 1);

/**
 * What is in a folder, to pick from: its folders, then what is in it.
 *
 * Everything the window can open, not only the notes: the documents beside
 * them and, where the folder is a repository, its files (repoFiles.ts). A
 * crumb over `web/src/components` that offered nothing because nothing there
 * is a note would be a door into an empty room.
 *
 * Mounted only while the list is up, so nothing here is built for a note that
 * is merely being read. A folder in it goes deeper — the list is the folder it
 * is showing, not the folder it was opened on — and the way back out is the
 * item at the top. The last item is the old way, kept: show it on the left.
 */
function FolderContents({ root, onOpen, close }: { root: string; onOpen: (path: string) => void; close: () => void }) {
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
	const documents = useSyncExternalStore(documentsStore.subscribe, documentsStore.get);
	const repo = useSyncExternalStore(repoStore.subscribe, repoStore.get);
	const [at, setAt] = useState(root);
	const notes = files.map((f) => f.path);
	const children = childrenOf([...new Set([...notes, ...documents, ...repo])], at);
	// The sidebar is the notes' tree, so a folder with no note under it is not
	// in it to be shown; offering to anyway is a control that does nothing.
	const inSidebar = notes.some((path) => path.startsWith(`${at}/`));
	const up = at === root ? null : at.slice(0, at.lastIndexOf("/"));
	return (
		<Command loop>
			<CommandInput placeholder={`Find in ${nameOf(at)}…`} />
			<CommandList className="max-h-72">
				<CommandEmpty>Nothing by that name in here.</CommandEmpty>
				<CommandGroup>
					{up !== null && (
						<CommandItem value={`..${up}`} onSelect={() => setAt(up)}>
							<ChevronLeft />
							<span className="truncate">{nameOf(up)}</span>
						</CommandItem>
					)}
					{children.map((node) =>
						node.kind === "folder" ? (
							<CommandItem key={node.path} value={node.path} onSelect={() => setAt(node.path)}>
								<FolderIcon />
								<span className="truncate">{node.name}</span>
								<ChevronRight className="ml-auto" />
							</CommandItem>
						) : (
							<CommandItem
								key={node.path}
								value={node.path}
								onSelect={() => {
									close();
									onOpen(node.path);
								}}
							>
								<FileTextIcon />
								<span className="truncate">{titleOf(node.path)}</span>
							</CommandItem>
						),
					)}
				</CommandGroup>
				{inSidebar && (
					<>
						<CommandSeparator />
						<CommandGroup>
							<CommandItem
								value={`show ${at} on the left`}
								onSelect={() => {
									close();
									show(at);
								}}
							>
								Show in sidebar
							</CommandItem>
						</CommandGroup>
					</>
				)}
			</CommandList>
		</Command>
	);
}

/**
 * One folder in the line: what it is called, and a door into it.
 *
 * Pressing it opens what is inside, so the note beside the one you are reading
 * is a click away rather than a trip to the column on the left — VS Code's
 * breadcrumb opens the same list from the same place. It used to open the
 * folder on the left instead; that is now the last item in the list, since
 * opening a note from here brings its folder into view anyway.
 *
 * The name is cut to a width rather than allowed any it asks for — a folder
 * named for a whole book title would push the rest of the path off the end —
 * with the whole of it on hover, as VS Code and the Finder do.
 */
function FolderCrumb({ folder, onOpen }: { folder: string; onOpen: (path: string) => void }) {
	const [open, setOpen] = useState(false);
	const name = nameOf(folder);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-crumb={folder}
					title={name}
					className="max-w-40 truncate rounded-sm px-1 py-0.5 hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
				>
					{name}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64 p-0">
				<FolderContents root={folder} onOpen={onOpen} close={() => setOpen(false)} />
			</PopoverContent>
		</Popover>
	);
}

/**
 * The folders a deep path hides between its ends, behind one "…".
 *
 * Same shape as the crumbs either side of it: a button that opens a menu
 * rather than jumping straight there, because there is more than one folder
 * under it and a click has to say which.
 */
function CrumbEllipsis({ folders }: { folders: string[] }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Folders in between"
					className="rounded-sm px-1 py-0.5 hover:bg-accent hover:text-accent-foreground"
				>
					<Ellipsis className="size-3" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				{folders.map((folder) => (
					<DropdownMenuItem key={folder} onSelect={() => show(folder)}>
						{nameOf(folder)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * What can be done to the note that is open, behind one mark.
 *
 * The delete used to sit beside the title inside the page, where it scrolled
 * out of sight as soon as anything was read — an action about the note that
 * leaves while the note is being looked at is in the wrong place. And one
 * click from the title is a short way to the trash for the only thing here
 * that cannot be undone by typing.
 *
 * The items themselves are in noteActions.ts, because the list in the sidebar
 * offers the same ones from a right click and the two must not drift.
 */
/**
 * A file is read here, and this is where that is said and what to do about it.
 *
 * The chip says the state; its menu answers the question the state raises —
 * where, then, do I change this? The editors on the machine, asked of macOS
 * and drawn with the names and icons macOS gave (editors.js), and the file
 * opened at the line being read. There is nothing to persist and nothing to
 * choose beforehand: what is installed is the list.
 *
 * With no shell there is no menu, and the chip is the plain label it was —
 * a page cannot start an app, which is the same reason Reveal in Finder is
 * not offered in a browser tab. With a shell but no editor found, the one
 * item hands the file to whatever macOS opens it with.
 */
function ReadOnly({ path }: { path: string }) {
	const [editors, setEditors] = useState<Editor[] | null>(null);
	// Asked when the menu is opened rather than when a file is: an app
	// installed while the window was up should be on the list, and nothing
	// should be asked of the shell for a file merely being read.
	const ask = (open: boolean) => {
		if (!open || !shell) return;
		shell.editors.list().then(
			(found) => setEditors(found ?? []),
			() => setEditors([]),
		);
	};
	const whole = () => wholePath(configStore.get()?.folder, path);
	const at = () => {
		const front = inFrontStore.get();
		return front?.path === path ? (front.line ?? 1) : 1;
	};
	const open = (scheme: string) => {
		void shell?.editors.open(scheme, whole(), at()).then((result) => result?.error && toast.error(result.error));
	};

	const chip = (
		<Badge
			id="readOnly"
			variant="secondary"
			className="shrink-0 gap-1 font-normal text-muted-foreground"
			title="This file is read-only. The agent changes the code; git moves and removes it."
		>
			<LockIcon className="size-3 shrink-0" />
			Read-only
		</Badge>
	);
	if (!shell) return chip;
	return (
		<DropdownMenu onOpenChange={ask}>
			<DropdownMenuTrigger asChild>
				<Badge
					asChild
					variant="secondary"
					className="shrink-0 gap-1 font-normal text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
				>
					<button type="button" id="readOnly" aria-label="Read-only — open this file elsewhere">
						<LockIcon className="size-3 shrink-0" />
						Read-only
						<ChevronDown className="size-3 shrink-0" />
					</button>
				</Badge>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				{editors === null ? (
					<DropdownMenuItem disabled>Looking…</DropdownMenuItem>
				) : editors.length === 0 ? (
					// No editor registered a scheme of its own. The Finder, not
					// whatever macOS opens a .ts with — that is as often Xcode as
					// anything the person would have chosen.
					<DropdownMenuItem onSelect={() => void shell.reveal(whole())}>Reveal in Finder</DropdownMenuItem>
				) : (
					editors.map((editor) => (
						<DropdownMenuItem key={editor.scheme} onSelect={() => open(editor.scheme)}>
							{editor.icon ? <img src={editor.icon} alt="" className="size-4 rounded-[3px]" /> : <SquareArrowOutUpRightIcon />}
							Open in {editor.name}
						</DropdownMenuItem>
					))
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function NoteMenu({ path }: { path: string }) {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button id="noteMenu" variant="ghost" size="icon-xs" aria-label="This note" className="shrink-0 text-muted-foreground">
							<MoreHorizontal />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">This note</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end">
				{noteActions(path).map((action, i) =>
					action === "separator" ? (
						<DropdownMenuSeparator key={i} />
					) : (
						<DropdownMenuItem
							key={action.label}
							variant={action.destructive ? "destructive" : undefined}
							disabled={action.needsServer && !online}
							onSelect={action.run}
						>
							{action.label}
						</DropdownMenuItem>
					),
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The note column's header: where the open note lives, what can be done to it,
 * and the one control that is about the pair of columns rather than either.
 *
 * Not the note's name. That is in the tab above and again at the top of the
 * page, where it is the field you rename by — a third copy would say nothing
 * the first two do not. What is not anywhere else is the folder: a tab has
 * room for the leaf only, and two notes called "Notes" in two folders are told
 * apart here. Linear's card carries a breadcrumb in the same place for the
 * same reason.
 *
 * The whole line is second-rank and one weight, the leaf included: a
 * breadcrumb says where you are, which is context and not content, and the
 * page under it is what is being read. Nothing in it needs standing up — the
 * name is on the tab above and at the top of the page in a size that means it.
 *
 * The folders in it are buttons. A breadcrumb that only names the place you
 * are in is half of one — the other half is that it takes you there — and
 * taking you there here means the column on the left, where the folder is
 * opened and brought into view. Not a toggle: this says go, and a second
 * press should not undo the going.
 *
 * One height with pi's header, so the two panes of the card start level.
 */
export function NoteHeader({ path, onOpen, trailing }: { path: string | null; onOpen: (path: string) => void; trailing?: React.ReactNode }) {
	// The same identifiers the sidebar keys its open folders on, so a crumb and
	// a row are talking about the same folder without either being told.
	const folders = path ? foldersOf(path) : [];
	const { head, hidden, tail } = splitCrumbs(folders);
	return (
		<div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-3 text-sm">
			<div id="crumbs" className="flex min-w-0 flex-1 items-center gap-0.5 truncate text-muted-foreground">
				{head.map((folder) => (
					<span key={folder} className="flex shrink-0 items-center gap-0.5">
						<FolderCrumb folder={folder} onOpen={onOpen} />
						<ChevronRight className="size-3 shrink-0" />
					</span>
				))}
				{hidden.length > 0 && (
					<span className="flex shrink-0 items-center gap-0.5">
						<CrumbEllipsis folders={hidden} />
						<ChevronRight className="size-3 shrink-0" />
					</span>
				)}
				{tail.map((folder, i) => (
					<span key={folder} className="flex shrink-0 items-center gap-0.5">
						{i > 0 && <ChevronRight className="size-3 shrink-0" />}
						<FolderCrumb folder={folder} onOpen={onOpen} />
					</span>
				))}
				{path && (
					<>
						{folders.length > 0 && <ChevronRight className="size-3 shrink-0" />}
						<span className="min-w-0 truncate">{titleOf(path)}</span>
					</>
				)}
			</div>
			{/* Beside the ⋯ rather than after the path, because it is not part of
			    where the file is: it is a state of the file and a way out of it,
			    which is what this end of the line is for. A chip rather than a
			    muted word — the words there are the line's colour, so the fill is
			    what says this is not more path. */}
			{path && isCode(path) && <ReadOnly path={path} />}
			{path && <NoteMenu path={path} />}
			{trailing}
		</div>
	);
}
