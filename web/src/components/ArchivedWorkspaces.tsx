import { useState } from "react";

import { ArchiveIcon } from "lucide-react";
import { toast } from "sonner";

import { branchName, useWorkspaceList, workspaceShell } from "./Repositories";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Spinner } from "./ui/spinner";

/**
 * The workspaces that were archived, every repository's, and the one thing
 * there is to do with each: bring it back. Here rather than under each
 * repository in the list of notes, which is for the work under way.
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

	const projects = (list?.projects ?? [])
		.map((project) => ({ ...project, worktrees: project.worktrees.filter((worktree) => worktree.state) }))
		.filter((project) => project.worktrees.length > 0);

	return (
		<>
			<header className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold">Archived</h2>
				<p className="text-xs text-subtle-foreground">Workspaces put away, with their branch kept. Bring one back to work in it again.</p>
			</header>
			{list === undefined ? (
				<p role="status" className="text-xs text-muted-foreground">Reading workspaces…</p>
			) : projects.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ArchiveIcon />
						</EmptyMedia>
						<EmptyTitle>No archived workspaces</EmptyTitle>
						<EmptyDescription>A workspace archived from its menu in the list shows here.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				projects.map((project) => (
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
				))
			)}
		</>
	);
}
