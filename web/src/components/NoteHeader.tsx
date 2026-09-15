import { useSyncExternalStore } from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import { titleOf } from "../noteSync";
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
 * The path is the one this app means everywhere else — what a row carries in
 * data-path, what open_note is told, what the link index is keyed on. The
 * window does not know what folder the vault is in, and a path that guessed
 * would be worse than one that is honest about being relative.
 */
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
				<DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(path)}>Copy path</DropdownMenuItem>
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
 * One height with pi's header, so the two panes of the card start level.
 */
export function NoteHeader({ path, trailing }: { path: string | null; trailing?: React.ReactNode }) {
	const folders = path?.includes("/") ? path.slice(0, path.lastIndexOf("/")).split("/") : [];
	return (
		<div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-3 text-sm">
			<div className="flex min-w-0 flex-1 items-center gap-0.5 truncate text-muted-foreground">
				{folders.map((folder, i) => (
					<span key={i} className="flex shrink-0 items-center gap-0.5">
						{i > 0 && <ChevronRight className="size-3 shrink-0" />}
						{folder}
					</span>
				))}
				{path && (
					<>
						{folders.length > 0 && <ChevronRight className="size-3 shrink-0" />}
						<span className="min-w-0 truncate font-medium text-foreground">{titleOf(path)}</span>
					</>
				)}
			</div>
			{path && <NoteMenu path={path} />}
			{trailing}
		</div>
	);
}
