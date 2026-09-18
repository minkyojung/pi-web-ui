import { useEffect, useState, useSyncExternalStore } from "react";

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { configStore } from "../serverState";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * Which folder this window works in, and a way to another — Obsidian's vault
 * switcher, in the same corner it keeps it.
 *
 * Two halves, because two things know: the server says where it is working,
 * which is true in a browser tab as much as in the app, and the shell says
 * what else there is and does the changing — a native dialog, and a server
 * for the other folder, neither of which a page can do (preload.cjs). Without
 * the shell the name is still worth drawing, so it is drawn, and only the menu
 * goes.
 *
 * Changing the folder points the window at that folder's server, and the one
 * left behind keeps running — see show() in main.js — so there is no route
 * here the shell does not already take for its own menu.
 */
interface Folders {
	/** Null while the shell has no folder to give: a dev run, where the dev server owns it. */
	current: string | null;
	recent: string[];
}

/** The preload's bridge, absent in a browser tab. */
const shell = (window as { pi?: { folders(): Promise<Folders>; choose(): Promise<void>; open(path: string): Promise<void> } }).pi;

const nameOf = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

export function FolderPicker() {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	// What else could be opened, asked for as the menu is opened: a folder may
	// have been used by another window since this one started.
	const [folders, setFolders] = useState<Folders | null>(null);
	useEffect(() => {
		if (!shell) return;
		shell.folders().then(setFolders, () => setFolders(null));
	}, []);

	const folder = config?.folder ?? null;
	if (!folder) return null;

	// No icon: every row above is a folder with a folder's icon, and one more
	// down here would read as another of them rather than as the whole.
	const name = <span className="truncate">{nameOf(folder)}</span>;
	const label = "min-w-0 flex-1 justify-start gap-1.5 px-1.5 text-xs font-normal text-muted-foreground";

	// No shell, or a dev run: the name, and nothing that pretends to lead
	// anywhere.
	if (!shell || !folders?.current) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div id="folder" className={`flex cursor-default items-center ${label}`}>
						{name}
					</div>
				</TooltipTrigger>
				<TooltipContent side="top">{folder}</TooltipContent>
			</Tooltip>
		);
	}

	const others = folders.recent.filter((path) => path !== folders.current);
	return (
		<DropdownMenu onOpenChange={(open) => open && shell.folders().then(setFolders, () => {})}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button id="folder" variant="ghost" size="sm" aria-label="Working folder" className={label}>
							{name}
							<ChevronsUpDownIcon className="size-3 shrink-0 opacity-60" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">{folder}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" side="top" className="max-h-80 w-64 overflow-y-auto">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Folder</DropdownMenuLabel>
				<DropdownMenuItem disabled className="opacity-100">
					<CheckIcon className="shrink-0" />
					<span className="truncate">{nameOf(folders.current)}</span>
				</DropdownMenuItem>
				{others.map((path) => (
					<DropdownMenuItem key={path} onSelect={() => shell.open(path)}>
						<span className="size-4 shrink-0" />
						<span className="truncate">{nameOf(path)}</span>
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				{/* The dialog is the shell's and modal to the window, so the menu is
				    let go of first — otherwise it would still be open behind it. */}
				<DropdownMenuItem onSelect={() => queueMicrotask(() => shell.choose())}>Open another folder…</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
