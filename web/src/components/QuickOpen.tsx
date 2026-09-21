import { useEffect, useState, useSyncExternalStore } from "react";
import { FilePlus } from "lucide-react";

import { titleOf } from "../noteSync";
import { repoOffers } from "../quickOpen";
import { documentsStore, filesStore, repoStore, repoTruncatedStore } from "../serverState";
import { send } from "../ws";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

/**
 * Open a file by name: ⌘P, type a few letters, Enter.
 *
 * A palette rather than a search box in the sidebar, since the list is the
 * one thing that has to stay small while the vault grows. Before anything is
 * typed it shows what was opened most recently, newest first, and the notes;
 * typed, it matches loosely over every note's path. A name that matches
 * nothing can be made: the last item creates a note of that name and opens
 * it, as Obsidian does with Shift-Enter — here it is just the item after the
 * matches.
 *
 * Where the folder is a repository the rest of its files are offered too
 * (quickOpen.ts), which is how the code the agent just wrote is reached
 * without leaving the window. They are the one group that waits for a letter
 * to be typed: there can be thousands of them, and the palette mounts what it
 * is given.
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
	const documents = useSyncExternalStore(documentsStore.subscribe, documentsStore.get);
	const repo = useSyncExternalStore(repoStore.subscribe, repoStore.get);
	const repoTruncated = useSyncExternalStore(repoTruncatedStore.subscribe, repoTruncatedStore.get);
	const [query, setQuery] = useState("");
	useEffect(() => {
		if (open) setQuery("");
	}, [open]);

	const listed = new Set([...files.map((f) => f.path), ...documents]);
	// What was opened recently is offered whatever kind it was, so a file read
	// a minute ago comes back by the same two keys as the note beside it.
	const paths = new Set([...listed, ...repo]);
	const recentHere = recent.filter((p) => paths.has(p));
	const trimmed = query.trim();
	const others = repoOffers(repo, listed, trimmed);
	const exact = trimmed && files.some((f) => titleOf(f.path).toLowerCase() === trimmed.toLowerCase());
	const pick = (path: string) => {
		onOpenChange(false);
		onPick(path);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
				<DialogTitle className="sr-only">Open a file</DialogTitle>
				<DialogDescription className="sr-only">Type part of a file's name and press Enter.</DialogDescription>
				<Command loop shouldFilter={trimmed.length > 0}>
					<CommandInput placeholder="Open a file…" value={query} onValueChange={setQuery} />
					<CommandList className="max-h-80">
						<CommandEmpty>Nothing by that name.</CommandEmpty>
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
						{documents.length > 0 && (
							<CommandGroup heading="Documents">
								{documents.map((path) => (
									<CommandItem key={path} value={path} onSelect={() => pick(path)}>
										{titleOf(path)}
										{path.includes("/") && <span className="ml-auto text-xs text-muted-foreground">{path.slice(0, path.lastIndexOf("/"))}</span>}
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{/* The rest of the repository, once there is a word to narrow it
						    by — the file the agent just wrote, reached without leaving
						    the window. Its name whole, extension and all, as the tab
						    that opens it says it (pages.ts). */}
						{others.length > 0 && (
							<CommandGroup heading="Files">
								{others.map((path) => (
									<CommandItem key={path} value={path} onSelect={() => pick(path)}>
										{path.slice(path.lastIndexOf("/") + 1)}
										{path.includes("/") && <span className="ml-auto text-xs text-muted-foreground">{path.slice(0, path.lastIndexOf("/"))}</span>}
									</CommandItem>
								))}
							</CommandGroup>
						)}
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
					{/* A file that is in the repository and in no list would be missing
					    from here with nothing to say why. Said once, under the list. */}
					{repoTruncated && (
						<div className="border-t px-3 py-2 text-xs text-muted-foreground">
							More files than this list will hold — the ones past that are not offered here.
						</div>
					)}
				</Command>
			</DialogContent>
		</Dialog>
	);
}
