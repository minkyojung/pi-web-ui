import { useEffect, useState } from "react";

import { CheckIcon, MoreHorizontalIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/** The remote's branches, the latest worked on first, and the one a workspace starts from when none is chosen. See git.js `remoteBranches`. */
export interface Branches {
	branches: string[];
	base: string | null;
}

/**
 * Where the new workspace starts, behind the dialog's ⋯ as Conductor keeps
 * it: out of sight, since it is nearly always the default branch, and there
 * for the spec that has to stand on another that is not merged yet
 * (spec-mode.md 6절). Chosen, it is said beside the ⋯, so that what Create
 * will do is never only behind a menu.
 *
 * Popover around Command, as shadcn's combobox is. The list is asked for
 * when it is opened — the shell fetches first, so it takes a moment — and
 * again for another repository.
 */
export function TargetBranch({
	root,
	value,
	onChange,
	ask,
	disabled,
}: {
	root: string | null;
	/** The branch chosen, or null for the default one. */
	value: string | null;
	onChange: (branch: string | null) => void;
	ask: (root: string) => Promise<Branches | null>;
	disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	// Undefined while the shell is asked; null when it cannot say.
	const [list, setList] = useState<Branches | null | undefined>(undefined);

	useEffect(() => {
		if (!open || !root) return;
		setList(undefined);
		let live = true;
		ask(root).then(
			(next) => live && setList(next),
			() => live && setList(null),
		);
		return () => {
			live = false;
		};
	}, [open, root, ask]);

	const current = value ?? list?.base ?? null;
	return (
		<span className="flex min-w-0 items-center gap-1">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button id="new-spec-more" variant="ghost" size="icon-sm" aria-label="Target branch" disabled={disabled || !root} className="shrink-0 text-muted-foreground">
						<MoreHorizontalIcon />
					</Button>
				</PopoverTrigger>
				<PopoverContent id="target-branch" align="start" className="w-72 p-0">
					<p className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
						Target branch
						{current && <span className="min-w-0 truncate font-medium text-foreground">origin/{current}</span>}
					</p>
					<Command>
						<CommandInput placeholder="Select target branch…" />
						<CommandList className="max-h-64">
							<CommandEmpty>{list === undefined ? "Asking the remote…" : list === null || list.branches.length === 0 ? "No branches on a remote to start from." : "No branch by that name."}</CommandEmpty>
							{list && list.branches.length > 0 && (
								<CommandGroup>
									{list.branches.map((branch) => (
										<CommandItem
											key={branch}
											value={branch}
											onSelect={() => {
												// The default one chosen is nothing chosen: it moves with the remote.
												onChange(branch === list.base ? null : branch);
												setOpen(false);
											}}
										>
											<CheckIcon className={branch === current ? "opacity-100" : "opacity-0"} />
											<span className="truncate">{branch}</span>
										</CommandItem>
									))}
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{value && (
				<span id="new-spec-from" className="min-w-0 truncate text-xs text-muted-foreground" title={`origin/${value}`}>
					from origin/{value}
				</span>
			)}
		</span>
	);
}
