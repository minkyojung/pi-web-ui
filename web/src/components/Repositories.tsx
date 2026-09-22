import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "cn";
import { ChevronRightIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { configStore, createStore } from "../serverState";
import { CloneRepository } from "./CloneRepository";
import type { BranchStatus } from "../branchStanding";
import { NewSpec, type SpecOnChoices } from "./NewSpec";
import { RemoveWorkspace } from "./RemoveWorkspace";
import { row } from "./sidebarRow";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * What the row says of the branch, after its name: a dot, in GitHub's colours
 * — open blue, merged grey, closed red — and nothing for a branch only here
 * or only pushed, which is work under way. The words are at the foot of the
 * window (BranchStanding.tsx), which is where there is room for them.
 */
export function statusDot(status: BranchStatus | undefined): { className: string; long: string } | null {
	if (!status || status.number === undefined) return null;
	switch (status.state) {
		case "open":
			return { className: "bg-blue-500", long: `Pull request #${status.number} is open` };
		case "merged":
			return { className: "bg-muted-foreground/60", long: `Pull request #${status.number} was merged` };
		case "closed":
			return { className: "bg-destructive", long: `Pull request #${status.number} was closed without merging` };
		default:
			return null;
	}
}

/** The list the shell keeps — see electron/workspaces.js and preload.cjs. */
export interface WorkspaceList {
	projects: { path: string; name: string; worktrees: { path: string; name: string; branch: string; status?: BranchStatus }[] }[];
}

/** The shell's side of the list, absent in a browser tab. */
const workspaceShell = (
	window as {
		pi?: {
			workspaces?: {
				list(): Promise<WorkspaceList | null>;
				create(root: string, first: { line: string; model: string | null; effort: string | null }, from: string | null): Promise<{ error?: string } | null>;
				branches(root: string): Promise<{ branches: string[]; base: string | null } | null>;
				open(path: string): Promise<void>;
				warm(path: string): Promise<void>;
				changes(path: string): Promise<number | null>;
				remove(path: string, seen: number): Promise<{ error?: string; changes?: number; warning?: string } | null>;
				setup(path: string): Promise<{ error?: string; ran?: boolean } | null>;
				onSetup(listen: (path: string, stage: "running" | null) => void): () => void;
				onChange(listen: () => void): () => void;
			};
		};
	}
).pi?.workspaces;

/** The shell asking for the new spec dialog, from its menu — see preload.cjs `onNewSpec`. */
const onNewSpec = (window as { pi?: { onNewSpec?: (listen: () => void) => () => void } }).pi?.onNewSpec;

/** The shell's way to a repository's open issues — see preload.cjs `repositories`. Null where there is no shell to ask. */
const issuesOf = (window as { pi?: { repositories?: { issues?(root: string): Promise<{ number: number; title: string; body: string }[] | null> } } }).pi?.repositories?.issues ?? (async () => null);

/** The shell's way to add a repository from the Finder — see preload.cjs `repositories`. */
const openLocal = (window as { pi?: { repositories?: { openLocal(): Promise<{ error?: string } | null> } } }).pi?.repositories?.openLocal;

/**
 * What a workspace's row says: its branch, less the owner every branch here
 * starts with — `minkyojung/email-auth` is `email-auth` in a list of the
 * same person's work. The whole of it is the row's tooltip.
 */
const branchName = (branch: string) => branch.slice(branch.indexOf("/") + 1);

/**
 * The repositories and their workspaces, as Conductor lists them: a row for
 * the repository that folds, a + on it that starts a spec — the one way a
 * workspace is made, see NewSpec.tsx — and under it a
 * row for each workspace, named by its branch. The shell keeps the list and
 * does the moving — the page asks, and the window is put on the workspace
 * chosen. In a browser tab, or a dev run, there is no shell to ask, and
 * nothing is drawn.
 */
/**
 * The workspace this page is a window on: the folder its server works in,
 * which is the one thing that says which row is this one. Not asked of the
 * shell — the shell knows which workspace the window is going to, and a page
 * still up while it goes there would be told that one.
 */
export function usePageFolder(): string | null {
	return useSyncExternalStore(configStore.subscribe, () => configStore.get()?.folder ?? null);
}

/**
 * The shell's list, kept up: `undefined` until the shell has answered, then
 * the list, or null where there is none — a browser tab, a dev run.
 */
/**
 * The list itself, the window's rather than any folder's: the same in every
 * workspace, so it is kept outside the tree — which is remade when the
 * window moves to another workspace (switch.ts) — and asked for once, then
 * again whenever the shell says it changed or the window comes back. What
 * was drawn stays drawn meanwhile.
 */
const listStore = createStore<WorkspaceList | null | undefined>(workspaceShell ? undefined : null, { window: true });
function loadList(): void {
	workspaceShell?.list().then(
		(next) => listStore.set(next),
		() => listStore.set(listStore.get() ?? null),
	);
}
if (workspaceShell) {
	loadList();
	workspaceShell.onChange(loadList);
	// A branch renamed inside a workspace — by hand, in a terminal — is news
	// only git has, so the list is asked again when the window comes back.
	window.addEventListener("focus", loadList);
}

export function useWorkspaceList(): WorkspaceList | null | undefined {
	const list = useSyncExternalStore(listStore.subscribe, listStore.get);
	/** The one way to ask, held where the turn below can reach it too. */
	const ask = useRef<() => void>(loadList);
	// And the moment a turn ends, which is the other time it changes: the turn
	// that names a spec renames the branch after it (spec.ts), so a row that
	// said `bangkok` says `email-auth` as the answer arrives rather than the
	// next time the window is clicked away from and back to.
	//
	// Not a race with that rename: pi awaits its extensions' agent_settled
	// before it emits the one the server turns into this (agent-session.ts),
	// so by the time a turn reads as ended here, git has the new name.
	const streaming = useSyncExternalStore(configStore.subscribe, () => configStore.get()?.isStreaming ?? false);
	const before = useRef(streaming);
	useEffect(() => {
		const was = before.current;
		before.current = streaming;
		if (was && !streaming) ask.current();
	}, [streaming]);
	return list;
}

export function Repositories({ list, choices }: { list: WorkspaceList; choices?: SpecOnChoices }) {
	/** The repository a spec is being started in, while the dialog for it is open. */
	const [starting, setStarting] = useState<{ path: string; name: string } | null>(null);
	/** The workspace being asked about before it is removed. */
	const [doomed, setDoomed] = useState<{ path: string; branch: string } | null>(null);
	const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
	const [cloning, setCloning] = useState(false);
	/**
	 * The workspace the window is on its way to, marked from the click until
	 * the shell answers: the page is replaced when the switch lands, so the
	 * mark is cleared only by a switch that does not — its server would not
	 * start, and the shell has said so in a dialog of its own.
	 */
	const [going, setGoing] = useState<string | null>(null);
	const go = (path: string) => {
		setGoing(path);
		shell.open(path).finally(() => setGoing((was) => (was === path ? null : was)));
	};
	/**
	 * A row the pointer has settled on for a moment is one about to be
	 * clicked, more often than not, and its server takes most of a second to
	 * start: it is started now, so the click finds it up. Settled, not
	 * crossed — a pointer on its way down the list starts nothing.
	 */
	const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
	const settle = (path: string) => {
		unsettle();
		settling.current = setTimeout(() => void shell.warm(path).catch(() => {}), 120);
	};
	const unsettle = () => {
		if (settling.current !== null) clearTimeout(settling.current);
		settling.current = null;
	};
	useEffect(() => unsettle, []);
	const shell = workspaceShell!;
	const here = usePageFolder();
	const folder = useRef(here);
	folder.current = here;

	// Asked for from the menu, it opens over the repository the window is in,
	// or the first there is; which one is changed in the dialog itself.
	const projects = useRef(list);
	projects.current = list;
	useEffect(
		() =>
			onNewSpec?.(() => {
				const { projects: all } = projects.current;
				const project = all.find((p) => p.worktrees.some((w) => w.path === folder.current)) ?? all[0];
				if (project) setStarting({ path: project.path, name: project.name });
			}),
		[],
	);

	// Adding one moves the window into it; what is left to say here is why not.
	const addLocal = () => {
		openLocal?.().then(
			(result) => result?.error && toast.error(result.error),
			(err: Error) => toast.error(err.message),
		);
	};

	const fold = (root: string) =>
		setFolded((was) => {
			const next = new Set(was);
			if (!next.delete(root)) next.add(root);
			return next;
		});

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* shadcn's sidebar group: a label, and the group's one action beside it —
			    centred over each repository's own +, which is a size larger. */}
			<div className="flex h-8 shrink-0 items-center justify-between pr-3 pl-4">
				<span className="text-xs font-medium text-muted-foreground">Repositories</span>
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button id="add-repository" variant="ghost" size="icon-xs" aria-label="Add a repository" className="text-muted-foreground">
									<PlusIcon />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent side="right">Add a repository</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="start" side="right">
						<DropdownMenuItem onSelect={addLocal}>Open local repository…</DropdownMenuItem>
						{/* The menu is let go of first, so the dialog is not opened behind it. */}
						<DropdownMenuItem id="clone-github" onSelect={() => queueMicrotask(() => setCloning(true))}>
							Clone from GitHub…
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<CloneRepository open={cloning} onOpenChange={setCloning} />
			<RemoveWorkspace workspace={doomed} onClose={() => setDoomed(null)} shell={shell} />
			<NewSpec repository={starting} repositories={list.projects} onRepository={setStarting} onClose={() => setStarting(null)} create={shell.create} setup={shell.onSetup} branches={shell.branches} issues={issuesOf} choices={choices} />
			<ul id="workspaces" className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-1">
				{list.projects.map((project) => (
					<li key={project.path}>
						<Collapsible open={!folded.has(project.path)} onOpenChange={() => fold(project.path)} className="group/repo">
							<div className="flex items-center gap-0.5">
								<CollapsibleTrigger asChild>
									<Button variant="ghost" size="sm" data-repo={project.path} className={cn(row, "min-w-0 flex-1 font-medium text-sidebar-foreground")}>
										<ChevronRightIcon className="transition-transform group-data-[state=open]/repo:rotate-90" />
										<span className="truncate">{project.name}</span>
									</Button>
								</CollapsibleTrigger>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon-sm"
											data-new-workspace={project.path}
											aria-label={`New spec in ${project.name}`}
											onClick={() => setStarting({ path: project.path, name: project.name })}
											className="shrink-0 text-muted-foreground"
										>
											<PlusIcon />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="right">New spec</TooltipContent>
								</Tooltip>
							</div>
							<CollapsibleContent asChild>
								<ul className="flex flex-col pl-3">
									{project.worktrees.map((worktree) => {
										const active = worktree.path === here;
										return (
											<li key={worktree.path}>
												{/* The menu wraps the tooltip, as the notes' rows do: both
												    want the row, and only one can be asChild of it. */}
												<ContextMenu>
												<Tooltip>
													<TooltipTrigger asChild>
														<ContextMenuTrigger asChild>
														<Button
															variant="ghost"
															size="sm"
															data-workspace={worktree.path}
															data-active={active}
															data-going={worktree.path === going}
															aria-current={active ? "page" : undefined}
															aria-busy={worktree.path === going || undefined}
															onClick={() => !active && go(worktree.path)}
															onPointerEnter={() => !active && settle(worktree.path)}
															onPointerLeave={unsettle}
															className={cn(
																row,
																"data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
																"data-[going=true]:bg-sidebar-accent data-[going=true]:text-sidebar-accent-foreground",
															)}
														>
															<GitBranchIcon />
															<span className="truncate">{branchName(worktree.branch)}</span>
															{/* Turning where the dot goes while the window is on its way there. */}
															{worktree.path === going ? (
																<Spinner className="ml-auto size-3 shrink-0" />
															) : (
																(() => {
																	const dot = statusDot(worktree.status);
																	return dot ? <span data-status={worktree.status?.state} aria-label={dot.long} className={cn("ml-auto size-1.5 shrink-0 rounded-full", dot.className)} /> : null;
																})()
															)}
														</Button>
														</ContextMenuTrigger>
													</TooltipTrigger>
													<TooltipContent side="right">
														{worktree.branch}
														{statusDot(worktree.status) && ` · ${statusDot(worktree.status)!.long}`}
													</TooltipContent>
												</Tooltip>
												<ContextMenuContent>
													{/* The menu is let go of first, so the dialog is not opened behind it. */}
													<ContextMenuItem variant="destructive" onSelect={() => queueMicrotask(() => setDoomed({ path: worktree.path, branch: branchName(worktree.branch) }))}>
														Remove workspace…
													</ContextMenuItem>
												</ContextMenuContent>
												</ContextMenu>
											</li>
										);
									})}
								</ul>
							</CollapsibleContent>
						</Collapsible>
					</li>
				))}
			</ul>
		</div>
	);
}
