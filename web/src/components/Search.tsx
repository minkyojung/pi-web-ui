import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { titleOf } from "../noteSync";
import { searchResultsStore } from "../serverState";
import type { SearchHit } from "../types";
import { send } from "../ws";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

/** How long typing pauses before the server is asked. Every ask reads every note. */
const DEBOUNCE = 150;

/**
 * Find words in any note: ⌘⇧F, type, Enter opens the note they are in.
 *
 * The server searches, not the tab — the notes are on its disk, and the tab
 * holds only the one open. Its answer is taken in its order, unfiltered.
 * Answers can arrive after a newer ask; each ask is numbered, and only the
 * answer to the latest is shown. Until it comes, the one before stays, so the
 * list does not blink empty between keystrokes.
 */
export function Search({
	open,
	onOpenChange,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPick: (path: string) => void;
}) {
	const [query, setQuery] = useState("");
	useEffect(() => {
		if (open) setQuery("");
	}, [open]);

	/** The number of the latest ask. Bumped on every change, so anything already sent is late. */
	const asked = useRef(0);
	const [shown, setShown] = useState<{ query: string; hits: SearchHit[] } | null>(null);
	const trimmed = query.trim();
	useEffect(() => {
		const id = ++asked.current;
		if (!open || !trimmed) {
			setShown(null);
			return;
		}
		const timer = setTimeout(() => send({ type: "search_notes", query: trimmed, id }), DEBOUNCE);
		return () => clearTimeout(timer);
	}, [open, trimmed]);

	const results = useSyncExternalStore(searchResultsStore.subscribe, searchResultsStore.get);
	useEffect(() => {
		if (results && results.id === asked.current) setShown({ query: results.query, hits: results.hits });
	}, [results]);

	const hits = shown?.hits ?? [];
	const pick = (path: string) => {
		onOpenChange(false);
		onPick(path);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
				<DialogTitle className="sr-only">Search every note</DialogTitle>
				<DialogDescription className="sr-only">Type words from a note and press Enter to open it.</DialogDescription>
				<Command loop shouldFilter={false}>
					<CommandInput placeholder="Search every note…" value={query} onValueChange={setQuery} />
					<CommandList className="max-h-96">
						{/* Only once the answer is to what is typed: before that, nothing is known. */}
						{shown?.query === trimmed && hits.length === 0 && <CommandEmpty>No note says that.</CommandEmpty>}
						{hits.map((hit) => (
							<CommandItem key={`${hit.path}:${hit.line}`} value={`${hit.path}:${hit.line}`} onSelect={() => pick(hit.path)}>
								<span className="max-w-[40%] shrink-0 truncate font-medium">{titleOf(hit.path)}</span>
								<span className="text-muted-foreground">·</span>
								<span className="min-w-0 truncate text-muted-foreground">
									{hit.text.slice(0, hit.from)}
									<mark className="bg-transparent font-medium text-foreground">{hit.text.slice(hit.from, hit.to)}</mark>
									{hit.text.slice(hit.to)}
								</span>
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
