import { useEffect, useState, useSyncExternalStore } from "react";
import { FilePlus } from "lucide-react";

import { titleOf } from "../noteSync";
import { filesStore } from "../serverState";
import { send } from "../ws";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

/**
 * Open a note by name: ⌘P, type a few letters, Enter.
 *
 * A palette rather than a search box in the sidebar, since the list is the
 * one thing that has to stay small while the vault grows. Before anything is
 * typed it shows the notes opened most recently, newest first; typed, it
 * matches loosely over every note's path. A name that matches nothing can be
 * made: the last item creates a note of that name and opens it, as Obsidian
 * does with Shift-Enter — here it is just the item after the matches.
 */
export function QuickOpen({
	open,
	onOpenChange,
	recent,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	recent: string[];
	onPick: (path: string) => void;
}) {
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
	const [query, setQuery] = useState("");
	useEffect(() => {
		if (open) setQuery("");
	}, [open]);

	const paths = new Set(files.map((f) => f.path));
	const recentHere = recent.filter((p) => paths.has(p));
	const trimmed = query.trim();
	const exact = trimmed && files.some((f) => titleOf(f.path).toLowerCase() === trimmed.toLowerCase());
	const pick = (path: string) => {
		onOpenChange(false);
		onPick(path);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
				<DialogTitle className="sr-only">Open a note</DialogTitle>
				<DialogDescription className="sr-only">Type part of a note's name and press Enter.</DialogDescription>
				<Command loop shouldFilter={trimmed.length > 0}>
					<CommandInput placeholder="Open a note…" value={query} onValueChange={setQuery} />
					<CommandList className="max-h-80">
						<CommandEmpty>No note by that name.</CommandEmpty>
						{!trimmed && recentHere.length > 0 && (
							<CommandGroup heading="Recent">
								{recentHere.map((path) => (
									<CommandItem key={path} value={path} onSelect={() => pick(path)}>
										{titleOf(path)}
										{path.includes("/") && <span className="ml-auto text-xs text-muted-foreground">{path.slice(0, path.lastIndexOf("/"))}</span>}
									</CommandItem>
								))}
							</CommandGroup>
						)}
						<CommandGroup heading={trimmed ? "Notes" : "All notes"}>
							{files.map((f) => (
								<CommandItem key={f.path} value={f.path} onSelect={() => pick(f.path)}>
									{titleOf(f.path)}
									{f.path.includes("/") && <span className="ml-auto text-xs text-muted-foreground">{f.path.slice(0, f.path.lastIndexOf("/"))}</span>}
								</CommandItem>
							))}
						</CommandGroup>
						{trimmed && !exact && (
							<CommandGroup forceMount heading="New">
								<CommandItem
									forceMount
									value={`__new__ ${trimmed}`}
									onSelect={() => {
										onOpenChange(false);
										send({ type: "new_note", name: trimmed });
									}}
								>
									<FilePlus />
									Create "{trimmed}"
								</CommandItem>
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
