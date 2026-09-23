import { useState } from "react";

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/spinner";

/**
 * Asked before a repository is taken off the list, because what it sounds
 * like is worse than what it is: nothing on the disk is touched. The clone is
 * the person's own folder, and was theirs before the app saw it; the
 * workspaces made from it stay where they are, with their branches. What goes
 * is the row — and adding the repository again brings all of it back, which
 * is the sentence this dialog exists to say (electron/main.js
 * removeRepository).
 */
export function RemoveRepository({ repository, onClose, remove }: {
	repository: { path: string; name: string; workspaces: number } | null;
	onClose: () => void;
	remove: (root: string) => Promise<{ error?: string } | null>;
}) {
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = () => {
		if (!repository) return;
		setRemoving(true);
		setError(null);
		remove(repository.path)
			.then((result) => (result?.error ? setError(result.error) : onClose()))
			.catch((err: Error) => setError(err.message))
			.finally(() => setRemoving(false));
	};

	const workspaces = repository?.workspaces ?? 0;
	return (
		<Dialog open={repository !== null} onOpenChange={(next) => !next && !removing && onClose()}>
			<DialogContent id="remove-repository" className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Take {repository?.name} off the list?</DialogTitle>
					<DialogDescription>
						Nothing on your disk is touched: the clone stays where it is, with its branches, and so
						{workspaces === 1 ? " does its one workspace" : workspaces > 0 ? ` do its ${workspaces} workspaces` : " do any workspaces it has"}.
						Adding the repository again brings the list back as it is now.
					</DialogDescription>
				</DialogHeader>
				{error && (
					<p id="remove-repository-error" role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="ghost" size="sm" disabled={removing} onClick={onClose}>
						Keep
					</Button>
					<Button id="remove-repository-confirm" variant="destructive" size="sm" disabled={removing} onClick={run}>
						{removing && <Spinner />}
						Take off the list
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
