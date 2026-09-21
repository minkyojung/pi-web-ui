import { useEffect, useState } from "react";

import { CircleDotIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** An open issue, as gh gives it. See electron/github.js `issues`. */
export interface Issue {
	number: number;
	title: string;
	body: string;
}

/**
 * What an issue puts in the dialog's box: its number and title, then what it
 * says. The number goes along so the agent — and the pull request at the end
 * — can name the issue the work is for.
 */
export const issueLine = (issue: Issue): string => (issue.body.trim() ? `#${issue.number} ${issue.title}\n\n${issue.body.trim()}` : `#${issue.number} ${issue.title}`);

/**
 * A spec started from one of the repository's open issues: chosen, its words
 * become the line, to be read and changed before Create like any other. Not
 * from a pull request or a branch that is already there — a workspace is
 * made for a spec, on a branch of its own (spec-mode.md 6절).
 *
 * The issues are gh's, as the repositories in the clone dialog are, and the
 * same is said when gh cannot say.
 */
export function FromIssue({ root, onPick, ask, disabled }: { root: string | null; onPick: (issue: Issue) => void; ask: (root: string) => Promise<Issue[] | null>; disabled: boolean }) {
	const [open, setOpen] = useState(false);
	// Undefined while gh is asked; null when it cannot say.
	const [list, setList] = useState<Issue[] | null | undefined>(undefined);

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

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button id="new-spec-issue" variant="ghost" size="icon-sm" aria-label="Start from an issue" disabled={disabled || !root} className="shrink-0 text-muted-foreground">
							<CircleDotIcon />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">Start from an issue</TooltipContent>
			</Tooltip>
			<PopoverContent id="from-issue" align="end" className="w-96 p-0">
				<Command>
					<CommandInput placeholder="Search open issues…" />
					<CommandList className="max-h-72">
						<CommandEmpty>{list === undefined ? "Asking GitHub…" : list === null ? "GitHub could not be asked." : list.length === 0 ? "No open issues." : "No issue by that name."}</CommandEmpty>
						{list && list.length > 0 && (
							<CommandGroup heading="Open issues">
								{list.map((issue) => (
									<CommandItem
										key={issue.number}
										value={`#${issue.number} ${issue.title}`}
										onSelect={() => {
											onPick(issue);
											setOpen(false);
										}}
									>
										<span className="shrink-0 text-muted-foreground">#{issue.number}</span>
										<span className="truncate">{issue.title}</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
					</CommandList>
					{list === null && (
						<p className="border-t px-3 py-2 text-xs text-muted-foreground">
							Sign in with <code>gh auth login</code> to start from an issue. The repository has to be one on GitHub.
						</p>
					)}
				</Command>
			</PopoverContent>
		</Popover>
	);
}
