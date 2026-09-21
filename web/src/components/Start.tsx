import { useState } from "react";

import { cn } from "cn";
import { FolderGit2Icon, GitBranchIcon } from "lucide-react";

import { CloneRepository } from "./CloneRepository";
import { Repositories, useWorkspaceList } from "./Repositories";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Toaster } from "./ui/sonner";
import { Spinner } from "./ui/spinner";
import { TooltipProvider } from "./ui/tooltip";

/** The shell's side: a repository chosen in the Finder and added. See preload.cjs `repositories`. */
const repositories = (window as { pi?: { repositories?: { openLocal(): Promise<{ error?: string } | null> } } }).pi?.repositories;

/**
 * The window with no workspace in front, which is where everyone begins:
 * adding a repository opens nothing, and a workspace is opened by asking for
 * one (spec-mode.md 6절). Served by the shell, since there is no folder for a
 * server to work in — so what is here is only what the shell knows.
 *
 * With no repository yet, shadcn's Empty, saying what the app works in and
 * offering the two ways to add one — a clone already on this Mac, or one
 * cloned from GitHub. With one, the list the sidebar shows, in the sidebar's
 * place, and the middle says what to do with it.
 *
 * The top strip is the window's to drag by — there is no title bar — and
 * keeps clear of the traffic lights, as the app's own top row does.
 */
export function Start() {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [cloning, setCloning] = useState(false);
	const list = useWorkspaceList();

	const openLocal = () => {
		if (!repositories) return;
		setBusy(true);
		setError(null);
		repositories
			.openLocal()
			.then((result) => setError(result?.error ?? null))
			.catch((err: Error) => setError(err.message))
			.finally(() => setBusy(false));
	};

	// Until the shell has said what there is, neither screen: one drawn and
	// then swapped for the other is a flash of the wrong thing to do.
	if (list === undefined) return <div className="drag-region h-11" />;
	const some = (list?.projects.length ?? 0) > 0;

	return (
		<TooltipProvider delayDuration={300}>
			<Toaster position="bottom-right" />
			<div className="flex h-screen text-foreground">
				{list && some && (
					<aside id="home-repositories" className="flex w-64 shrink-0 flex-col text-sidebar-foreground">
						<div className="drag-region h-11 shrink-0" />
						<Repositories list={list} />
					</aside>
				)}
				<main className={cn("flex min-w-0 flex-1 flex-col bg-background", some && "border-l")}>
					<div className="drag-region h-11 shrink-0" />
					{some ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<GitBranchIcon />
								</EmptyMedia>
								<EmptyTitle>No workspace open</EmptyTitle>
								<EmptyDescription>Open a workspace from the list, or make one with + beside its repository.</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FolderGit2Icon />
								</EmptyMedia>
								<EmptyTitle>Add a repository</EmptyTitle>
								<EmptyDescription>Octave works in a git repository. Each task gets a workspace of its own — a folder and a branch — made from it.</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<div className="flex gap-2">
									<Button id="open-local" onClick={openLocal} disabled={busy || !repositories}>
										{busy && <Spinner />}
										Open local repository
									</Button>
									<Button id="clone-github" variant="outline" onClick={() => setCloning(true)} disabled={busy || !repositories}>
										Clone from GitHub
									</Button>
								</div>
								{error && (
									<p id="start-error" role="alert" className="text-sm text-destructive">
										{error}
									</p>
								)}
							</EmptyContent>
						</Empty>
					)}
				</main>
			</div>
			<CloneRepository open={cloning} onOpenChange={setCloning} />
		</TooltipProvider>
	);
}
