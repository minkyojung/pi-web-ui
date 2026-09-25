import { useEffect, useState, useSyncExternalStore } from "react";

import type { Work } from "../branchStanding";
import { changesTargetStore } from "../changesTarget";
import { changesPath, commitPath } from "../pages";
import { standingStore, workStore } from "../serverState";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Size } from "./Size";

const WORDS = { added: "New", modified: "", deleted: "Deleted", renamed: "Renamed" } as const;

/**
 * What is on this machine and not on origin: `Changes 5 ↑3 ↓1`, each left
 * out at 0, and behind it the list. The words and arrows are the strip's
 * grey and the figures the text's own colour, as Zed and VS Code draw a
 * count — the figure is what is read, and grey on grey at this size is what
 * made the strip hard to read. An arrow is VS Code's and GitHub Desktop's:
 * up is what a push would send, down what a pull would bring, both against
 * origin.
 *
 * The list is the tasks button's twin (TaskResults.tsx): a Popover, since
 * what is in it is pressed, with a Command inside for the arrows, Enter and
 * narrowing by a word. Two groups, as Conductor's changes are: the files
 * changed and not committed — a line opens the Changes page at that file,
 * each marked as the commit's page marks it (Commit.tsx) — and the commits
 * a push would send, a line opening that commit's page. Asked for when it
 * opens and again while it is open whenever the standing moves, since a
 * turn that ends with the list up has just changed what is in it.
 */
export function WorkStanding({ work, onOpen }: { work: Work; onOpen: (path: string) => void }) {
	const [up, setUp] = useState(false);
	const listed = useSyncExternalStore(workStore.subscribe, workStore.get);
	const git = useSyncExternalStore(standingStore.subscribe, standingStore.get);
	useEffect(() => {
		if (up) send({ type: "ask_work" });
	}, [up, git]);
	const go = (path: string, file?: string) => {
		setUp(false);
		if (file !== undefined) changesTargetStore.set(file);
		onOpen(path);
	};
	const figure = (count: number) => <span className="tabular-nums">{count}</span>;
	const files = listed?.files ?? [];
	const commits = listed?.commits ?? [];
	const total = files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), deleted: sum.deleted + (file.deleted ?? 0) }), { added: 0, deleted: 0 });
	return (
		<Popover
			open={up}
			onOpenChange={(next) => {
				// What was listed last time is from then: not drawn under a list about to change.
				if (next) workStore.set(null);
				setUp(next);
			}}
		>
			<PopoverTrigger asChild>
				<Button id="work-standing" variant="ghost" size="sm" className="cursor-default gap-2 px-1.5 text-xs font-normal">
					{work.changes > 0 && <span data-changes={work.changes}>Changes {figure(work.changes)}</span>}
					{work.push > 0 && (
						<span data-push={work.push} title={work.published ? `${work.push} to push` : "Not on origin"}>
							↑{figure(work.push)}
						</span>
					)}
					{work.pull > 0 && (
						<span data-pull={work.pull} title={`${work.pull} to pull`}>
							↓{figure(work.pull)}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="end" className="w-96 p-0">
				<Command loop>
					<div className="flex items-baseline gap-2 px-3 pt-2.5 pb-1 text-xs">
						<span className="min-w-0 truncate font-medium text-foreground">{git?.branch}</span>
						{files.length > 0 && (
							<span className="ml-auto text-muted-foreground">
								<Size {...total} />
							</span>
						)}
					</div>
					{/* Past a handful, a word finds the one wanted. */}
					{files.length + commits.length > 6 && <CommandInput placeholder="Find a file or a commit…" />}
					<CommandList className="max-h-80">
						{listed === null ? <div className="px-3 py-2 text-xs text-muted-foreground">Reading…</div> : <CommandEmpty>Nothing by that.</CommandEmpty>}
						{files.length > 0 && (
							<CommandGroup heading="Changes">
								{files.map((file) => {
									const cut = file.path.lastIndexOf("/") + 1;
									return (
										<CommandItem key={file.path} value={`file ${file.path}`} data-work-file={file.path} title={file.from ? `${file.path} ← ${file.from}` : file.path} onSelect={() => go(changesPath, file.path)} className="gap-2">
											<span className="min-w-0 truncate">
												<span className="text-muted-foreground">{file.path.slice(0, cut)}</span>
												{file.path.slice(cut)}
											</span>
											{WORDS[file.status] && <span className="shrink-0 text-xs text-muted-foreground">{WORDS[file.status]}</span>}
											{file.added !== null && file.deleted !== null && (
												<span className="ml-auto pl-2 text-[11px]">
													<Size added={file.added} deleted={file.deleted} />
												</span>
											)}
										</CommandItem>
									);
								})}
								{listed?.truncated && <div className="px-2 py-1.5 text-xs text-muted-foreground">More files are changed than are listed.</div>}
							</CommandGroup>
						)}
						{commits.length > 0 && (
							<CommandGroup heading="To push">
								{commits.map((commit) => (
									<CommandItem key={commit.commit} value={`commit ${commit.short} ${commit.title}`} data-work-commit={commit.commit} onSelect={() => go(commitPath(commit.commit))} className="gap-2">
										<span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">{commit.short}</span>
										<span className="min-w-0 truncate">{commit.title}</span>
									</CommandItem>
								))}
								{work.push > commits.length && <div className="px-2 py-1.5 text-xs text-muted-foreground">and {work.push - commits.length} more</div>}
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
