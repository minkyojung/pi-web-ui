import { useState } from "react";

import { FolderGit2Icon } from "lucide-react";

import { CloneRepository } from "./CloneRepository";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Spinner } from "./ui/spinner";

/** The shell's side: a repository chosen in the Finder and added. See preload.cjs `repositories`. */
const repositories = (window as { pi?: { repositories?: { openLocal(): Promise<{ error?: string } | null> } } }).pi?.repositories;

/**
 * No repository yet: shadcn's Empty, saying what the app works in and
 * offering the two ways to add one — a clone already on this Mac, or one
 * cloned from GitHub. Adding it makes its first workspace and moves
 * the window into it, as Conductor does, so this screen is left behind.
 *
 * The top strip is the window's to drag by — there is no title bar — and
 * keeps clear of the traffic lights, as the app's own top row does.
 */
export function Start() {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [cloning, setCloning] = useState(false);

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

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<div className="drag-region h-11 shrink-0" />
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
			<CloneRepository open={cloning} onOpenChange={setCloning} />
		</div>
	);
}
