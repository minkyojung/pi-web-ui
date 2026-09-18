import { useEffect, useState } from "react";

import { DownloadIcon, LockIcon } from "lucide-react";

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/spinner";

interface Repository {
	name: string;
	description: string;
	private: boolean;
}

/** The shell's side. See preload.cjs `repositories`. */
const shell = (
	window as {
		pi?: { repositories?: { clone(source: string): Promise<{ error?: string } | null>; github(): Promise<Repository[] | null> } };
	}
).pi?.repositories;

/**
 * Whether what is typed could name a repository on its own: owner/name, or a
 * GitHub address. Only for offering it — the shell reads it again, strictly,
 * before anything is cloned (github.js).
 */
const namesRepository = (text: string) => /^[\w.-]+\/[\w.-]+$/.test(text) || /^(https:\/\/github\.com\/|git@github\.com:)/.test(text);

/**
 * Clone a repository from GitHub: the person's own, as gh lists them, to
 * search among, or any repository by owner/name or address, typed or pasted.
 * Cloning adds it and moves the window into its first workspace, so the
 * dialog is not seen closing — it closes itself only on success, and says
 * what went wrong otherwise.
 *
 * Dialog around Command, as QuickOpen is: the list narrows as it is typed
 * into, and Enter takes the item in front.
 */
export function CloneRepository({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const [query, setQuery] = useState("");
	// Undefined while gh is asked; null when it cannot say — not installed, not signed in.
	const [list, setList] = useState<Repository[] | null | undefined>(undefined);
	const [cloning, setCloning] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !shell) return;
		setQuery("");
		setError(null);
		let live = true;
		shell.github().then(
			(repos) => live && setList(repos),
			() => live && setList(null),
		);
		return () => {
			live = false;
		};
	}, [open]);

	const typed = query.trim();
	const listed = list?.some((repo) => repo.name.toLowerCase() === typed.toLowerCase()) ?? false;
	const run = (source: string) => {
		if (!shell) return;
		setCloning(source);
		setError(null);
		shell
			.clone(source)
			.then((result) => (result?.error ? setError(result.error) : onOpenChange(false)))
			.catch((err: Error) => setError(err.message))
			.finally(() => setCloning(null));
	};

	return (
		// A clone under way is not walked away from by Escape or a click outside:
		// it goes on either way, and the window moves when it is done.
		<Dialog open={open} onOpenChange={(next) => cloning === null && onOpenChange(next)}>
			<DialogContent id="clone" className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
				<DialogTitle className="sr-only">Clone from GitHub</DialogTitle>
				<DialogDescription className="sr-only">Search your repositories, or give one as owner/name or its GitHub address.</DialogDescription>
				<Command loop>
					<CommandInput placeholder="Search your repositories, or paste an address…" value={query} onValueChange={setQuery} disabled={cloning !== null} />
					<CommandList className="max-h-80">
						{cloning !== null ? (
							<div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
								<Spinner />
								Cloning {cloning}…
							</div>
						) : (
							<>
								<CommandEmpty>{list === undefined ? "Asking GitHub…" : list === null ? "Type owner/name or a GitHub address." : "No repository by that name."}</CommandEmpty>
								{typed && namesRepository(typed) && !listed && (
									<CommandGroup>
										<CommandItem value={`clone ${typed}`} onSelect={() => run(typed)}>
											<DownloadIcon />
											<span className="truncate">Clone {typed}</span>
										</CommandItem>
									</CommandGroup>
								)}
								{list && list.length > 0 && (
									<CommandGroup heading="Your repositories">
										{list.map((repo) => (
											<CommandItem key={repo.name} value={repo.name} keywords={repo.description ? [repo.description] : undefined} onSelect={() => run(repo.name)}>
												<span className="truncate">{repo.name}</span>
												{repo.private && <LockIcon className="ml-auto text-muted-foreground" aria-label="Private" />}
											</CommandItem>
										))}
									</CommandGroup>
								)}
							</>
						)}
					</CommandList>
					{list === null && cloning === null && (
						<p className="border-t px-3 py-2 text-xs text-muted-foreground">
							Sign in with <code>gh auth login</code> to see your repositories here and clone private ones.
						</p>
					)}
					{error && (
						<p id="clone-error" role="alert" className="border-t px-3 py-2 text-sm text-destructive">
							{error}
						</p>
					)}
				</Command>
			</DialogContent>
		</Dialog>
	);
}
