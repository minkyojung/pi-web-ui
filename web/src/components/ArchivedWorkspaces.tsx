import { useState } from "react";

import { ArchiveIcon } from "lucide-react";
import { toast } from "sonner";

import { branchName, useWorkspaceList, workspaceShell } from "./Repositories";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Spinner } from "./ui/spinner";

/** The shell's way to put a repository taken off the list back on it — see preload.cjs `repositories`. */
const showRepository = (window as { pi?: { repositories?: { show(root: string): Promise<{ error?: string } | null> } } }).pi?.repositories?.show;

/**
 * The workspaces that were archived, every repository's, and the
 * repositories taken off the list, and the one thing there is to do with
 * each: bring it back. Here rather than in the list of notes, which is for
 * the work under way. A repository comes back with its workspaces, as it
 * does when it is added again (electron/main.js showRepository).
 */
export function ArchivedWorkspaces() {
	const list = useWorkspaceList();
	/**
	 * The ones being brought back, for their rows to say so. The shell makes
	 * the folder again and then runs the repository's setup, which can take as
	 * long as an install: the row leaves as soon as there is a folder, and the
	 * window goes there when it is ready.
	 */
	const [restoring, setRestoring] = useState<ReadonlySet<string>>(() => new Set());
	const restore = (path: string) => {
		setRestoring((was) => new Set(was).add(path));
		const done = () =>
			setRestoring((was) => {
				const next = new Set(was);
				next.delete(path);
				return next;
			});
		workspaceShell!.restore(path).then(
			(result) => {
				done();
				if (result?.error) toast.error(result.error);
			},
			(err: Error) => {
				done();
				toast.error(err.message);
			},
		);
	};

	/** The repository being put back, for its row to say so; the list redraws without it when the shell has. */
	const [showing, setShowing] = useState<string | null>(null);
	const show = (root: string) => {
		setShowing(root);
		showRepository?.(root).then(
			(result) => {
				setShowing(null);
				if (result?.error) toast.error(result.error);
			},
			(err: Error) => {
				setShowing(null);
				toast.error(err.message);
			},
		);
	};

	const hidden = list?.hidden ?? [];
	const projects = (list?.projects ?? [])
		.map((project) => ({ ...project, worktrees: project.worktrees.filter((worktree) => worktree.state) }))
		.filter((project) => project.worktrees.length > 0);

	return (
		<>
			<header className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold">Archived</h2>
				<p className="text-xs text-subtle-foreground">Workspaces put away with their branch kept, and repositories taken off the list with nothing on the disk touched. Bring one back to work in it again.</p>
			</header>
			{list === undefined ? (
				<p role="status" className="text-xs text-muted-foreground">Reading workspaces…</p>
			) : projects.length === 0 && hidden.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ArchiveIcon />
						</EmptyMedia>
						<EmptyTitle>Nothing archived</EmptyTitle>
						<EmptyDescription>A workspace archived, or a repository taken off the list, from its menu in the list shows here.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
				{projects.map((project) => (
					<div key={project.path} data-archived={project.path} className="flex flex-col gap-1">
						<h3 className="text-xs font-medium text-muted-foreground">{project.name}</h3>
						<ul className="flex flex-col divide-y rounded-md border">
							{project.worktrees.map((worktree) => {
								const busy = restoring.has(worktree.path) || worktree.state === "archiving";
								return (
									<li key={worktree.path} className="flex items-center gap-3 px-3 py-2">
										<div className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-sm">{branchName(worktree.branch)}</span>
											<span className="truncate text-xs text-muted-foreground">
												{worktree.state === "archiving" ? "Archiving…" : worktree.branch}
											</span>
										</div>
										<Button
											variant="outline"
											size="sm"
											data-archived-workspace={worktree.path}
											disabled={busy}
											onClick={() => restore(worktree.path)}
										>
											{restoring.has(worktree.path) && <Spinner />}
											Restore
										</Button>
									</li>
								);
							})}
						</ul>
					</div>
				))}
				{hidden.length > 0 && (
					<div id="hidden-repositories" className="flex flex-col gap-1">
						<h3 className="text-xs font-medium text-muted-foreground">Off the list</h3>
						<ul className="flex flex-col divide-y rounded-md border">
							{hidden.map((repository) => (
								<li key={repository.path} className="flex items-center gap-3 px-3 py-2">
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm">{repository.name}</span>
										<span className="truncate text-xs text-muted-foreground" title={repository.path}>
											{repository.workspaces === 1 ? "1 workspace" : `${repository.workspaces} workspaces`} · {repository.path}
										</span>
									</div>
									<Button variant="outline" size="sm" data-hidden-repository={repository.path} disabled={showing !== null} onClick={() => show(repository.path)}>
										{showing === repository.path && <Spinner />}
										Add back
									</Button>
								</li>
							))}
						</ul>
					</div>
				)}
				</>
			)}
		</>
	);
}
