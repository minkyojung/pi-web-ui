import { Command, CommandGroup, CommandItem, CommandList } from "./ui/command";

export interface Suggestion {
	/** What is picked, and what tells one row from another. */
	value: string;
	label: string;
	detail?: string;
	tag?: string;
}

/**
 * The rows offered above the box while a word is being completed — a command
 * after "/" (commandMenu.ts), a note after "@" (noteMention.ts).
 *
 * Drawn as a list, not opened as a popover: the keys that move through it
 * and take from it are the box's own, since the box keeps the focus, and a
 * popover that watches focus would close itself. The chosen row is the
 * box's state; the list only shows it.
 */
export function SuggestMenu({
	id,
	items,
	selected,
	onSelect,
	onPick,
}: {
	id: string;
	items: Suggestion[];
	selected: string;
	onSelect: (value: string) => void;
	onPick: (value: string) => void;
}) {
	if (items.length === 0) return null;
	return (
		<div id={id} className="absolute inset-x-0 bottom-full z-20 mb-1">
			<Command shouldFilter={false} value={selected} onValueChange={onSelect} className="rounded-lg border shadow-md">
				<CommandList className="max-h-60">
					<CommandGroup>
						{items.map((s) => (
							<CommandItem key={s.value} value={s.value} onSelect={() => onPick(s.value)} className="gap-2">
								<span className="shrink-0">{s.label}</span>
								{s.detail && <span className="min-w-0 truncate text-muted-foreground">{s.detail}</span>}
								{s.tag && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{s.tag}</span>}
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</div>
	);
}
