import { useSyncExternalStore } from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import { titleOf, wholePath } from "../noteSync";
import { configStore } from "../serverState";
import { foldersOf, openFoldersStore, setOpenFolders } from "../tree";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * What can be done to the note that is open, behind one mark.
 *
 * The delete used to sit beside the title inside the page, where it scrolled
 * out of sight as soon as anything was read — an action about the note that
 * leaves while the note is being looked at is in the wrong place. And one
 * click from the title is a short way to the trash for the only thing here
 * that cannot be undone by typing.
 *
 * Renaming is not done here; it is done in the title, which is a field. This
 * only sends you to it, for the same reason a menu carries Rename in a file
 * list where double-clicking the name also works.
 *
 * The path is the whole one. The server says which folder it works in, in
 * full, and says it over the socket rather than through the shell — so a
 * browser tab is told as much as the app is, and the note's own path only has
 * to be joined onto it. A path to paste somewhere else is not much use
 * relative to a folder the somewhere else has never heard of.
 *
 * The Finder is the shell's to open and is not there in a tab, so that item
 * goes rather than sitting greyed: the same way the folder picker draws a
 * name and no menu when it is running without a shell.
 */

/** The preload's bridge, absent in a browser tab. */
const shell = (window as { pi?: { reveal(path: string): Promise<void> } }).pi;
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

function NoteMenu({ path }: { path: string }) {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	// Read where it is used rather than subscribed to: the folder is wanted at
	// the moment of a press and never drawn, so nothing here has to redraw for it.
	const whole = () => wholePath(configStore.get()?.folder, path);
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
				<DropdownMenuItem
					disabled={!online}
					onSelect={() => {
						// After the menu has closed, or Radix takes the focus back.
						requestAnimationFrame(() => {
							const box = document.querySelector<HTMLInputElement>("#title");
							box?.focus();
							box?.select();
						});
					}}
				>
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(whole())}>Copy path</DropdownMenuItem>
				{shell && <DropdownMenuItem onSelect={() => void shell.reveal(whole())}>Reveal in Finder</DropdownMenuItem>}
				<DropdownMenuSeparator />
				{/* To the trash, not gone: the column offers Restore afterwards, so
				    there is nothing to confirm here. */}
				<DropdownMenuItem variant="destructive" disabled={!online} aria-label="Delete note" onSelect={() => send({ type: "delete_note", path })}>
					Delete
				</DropdownMenuItem>
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
	return (
		<div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-3 text-sm">
			<div className="flex min-w-0 flex-1 items-center gap-0.5 truncate text-muted-foreground">
				{folders.map((folder, i) => (
					<span key={folder} className="flex shrink-0 items-center gap-0.5">
						{i > 0 && <ChevronRight className="size-3 shrink-0" />}
						<button
							type="button"
							data-crumb={folder}
							className="truncate rounded-sm px-1 py-0.5 hover:bg-accent hover:text-accent-foreground"
							onClick={() => show(folder)}
						>
							{folder.slice(folder.lastIndexOf("/") + 1)}
						</button>
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
