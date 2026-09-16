import { useSyncExternalStore } from "react";
import { ChevronRight, Ellipsis, MoreHorizontal } from "lucide-react";

import { noteActions } from "../noteActions";
import { showAuthorsStore } from "../features/authors";
import { titleOf } from "../noteSync";
import { foldersOf, openFoldersStore, setOpenFolders } from "../tree";
import { getConnection, subscribe } from "../store";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
const CRUMB_TAIL = 2;

/** `folders`, split into what stays at each end and what collapses behind `…`. */
function splitCrumbs(folders: string[]): { head: string[]; hidden: string[]; tail: string[] } {
	if (folders.length <= CRUMB_HEAD + CRUMB_TAIL) return { head: [], hidden: [], tail: folders };
	return {
		head: folders.slice(0, CRUMB_HEAD),
		hidden: folders.slice(CRUMB_HEAD, folders.length - CRUMB_TAIL),
		tail: folders.slice(folders.length - CRUMB_TAIL),
	};
}

function FolderCrumb({ folder }: { folder: string }) {
	return (
		<button
			type="button"
			data-crumb={folder}
			className="truncate rounded-sm px-1 py-0.5 hover:bg-accent hover:text-accent-foreground"
			onClick={() => show(folder)}
		>
			{folder.slice(folder.lastIndexOf("/") + 1)}
		</button>
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
						{folder.slice(folder.lastIndexOf("/") + 1)}
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
function NoteMenu({ path }: { path: string }) {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const showing = useSyncExternalStore(showAuthorsStore.subscribe, showAuthorsStore.get);
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
				{/* A view of the note rather than a thing done to it, and about the
				    one that is open rather than any note in the list — so it is here
				    and not in the actions the list's own menu shares. */}
				<DropdownMenuCheckboxItem id="whoWrote" checked={showing} onCheckedChange={(on) => showAuthorsStore.set(on)}>
					Who wrote what
				</DropdownMenuCheckboxItem>
				<DropdownMenuSeparator />
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
export function NoteHeader({ path, trailing }: { path: string | null; trailing?: React.ReactNode }) {
	// The same identifiers the sidebar keys its open folders on, so a crumb and
	// a row are talking about the same folder without either being told.
	const folders = path ? foldersOf(path) : [];
	const { head, hidden, tail } = splitCrumbs(folders);
	return (
		<div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-3 text-sm">
			<div className="flex min-w-0 flex-1 items-center gap-0.5 truncate text-muted-foreground">
				{head.map((folder) => (
					<span key={folder} className="flex shrink-0 items-center gap-0.5">
						<FolderCrumb folder={folder} />
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
						<FolderCrumb folder={folder} />
					</span>
				))}
				{path && (
					<>
						{folders.length > 0 && <ChevronRight className="size-3 shrink-0" />}
						<span className="min-w-0 truncate">{titleOf(path)}</span>
					</>
				)}
			</div>
			{path && <NoteMenu path={path} />}
			{trailing}
		</div>
	);
}
