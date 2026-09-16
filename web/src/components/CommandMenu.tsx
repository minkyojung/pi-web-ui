import type { CommandInfo } from "../../../protocol";
import { Command, CommandGroup, CommandItem, CommandList } from "./ui/command";

const SOURCE: Record<CommandInfo["source"], string> = { extension: "command", prompt: "prompt", skill: "skill" };

/**
 * The commands offered above the box while one is being named — see
 * commandMenu.ts for what that means.
 *
 * Drawn as a list, not opened as a popover: the keys that move through it
 * and take from it are the box's own, since the box keeps the focus, and a
 * popover that watches focus would close itself. The chosen row is the
 * box's state; the list only shows it.
 */
export function CommandMenu({
	commands,
	selected,
	onSelect,
	onPick,
}: {
	commands: CommandInfo[];
	selected: string;
	onSelect: (name: string) => void;
	onPick: (name: string) => void;
}) {
	if (commands.length === 0) return null;
	return (
		<div id="commands" className="absolute inset-x-0 bottom-full z-20 mb-1">
			<Command
				shouldFilter={false}
				value={selected}
				onValueChange={onSelect}
				className="rounded-lg border shadow-md"
			>
				<CommandList className="max-h-60">
					<CommandGroup>
						{commands.map((c) => (
							<CommandItem key={c.name} value={c.name} onSelect={() => onPick(c.name)} className="gap-2">
								<span className="shrink-0">/{c.name}</span>
								{c.description && <span className="min-w-0 truncate text-muted-foreground">{c.description}</span>}
								<span className="ml-auto shrink-0 text-xs text-muted-foreground">{SOURCE[c.source]}</span>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</Command>
		</div>
	);
}
