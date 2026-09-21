import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/spinner";

/** The shell's side: how many uncommitted changes a workspace holds, and the removing. See preload.cjs `workspaces`. */
export interface Removing {
	changes(path: string): Promise<number | null>;
	remove(path: string, seen: number): Promise<{ error?: string; changes?: number } | null>;
}

/**
 * Asked before a workspace is removed, since its folder is deleted: what
 * goes and what stays — the branch and its commits, and the conversation —
 * and, when the folder holds changes no commit has, how many would go with
 * it. The shell is told the number that was read here, and removes nothing
 * if the folder holds another by then: the new number is shown instead, to
 * be read and asked about again (electron/main.js removeWorkspace).
 */
export function RemoveWorkspace({ workspace, onClose, shell }: { workspace: { path: string; branch: string } | null; onClose: () => void; shell: Removing }) {
	// Undefined while git is asked; null when it could not say.
	const [changes, setChanges] = useState<number | null | undefined>(undefined);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!workspace) return;
		setChanges(undefined);
		setError(null);
		let live = true;
		shell.changes(workspace.path).then(
			(n) => live && setChanges(n),
			() => live && setChanges(null),
		);
		return () => {
			live = false;
		};
	}, [workspace, shell]);

	const run = () => {
		if (!workspace || typeof changes !== "number") return;
		setRemoving(true);
		setError(null);
		shell
			.remove(workspace.path, changes)
			.then((result) => {
				if (result?.error) setError(result.error);
				else if (typeof result?.changes === "number") setChanges(result.changes);
				else onClose();
			})
			.catch((err: Error) => setError(err.message))
			.finally(() => setRemoving(false));
	};

	return (
		<Dialog open={workspace !== null} onOpenChange={(next) => !next && !removing && onClose()}>
			<DialogContent id="remove-workspace" className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Remove {workspace?.branch}?</DialogTitle>
					<DialogDescription>Its folder is deleted. The branch and its commits stay, and so does the conversation.</DialogDescription>
				</DialogHeader>
				{typeof changes === "number" && changes > 0 && (
					<p id="remove-workspace-changes" className="text-sm text-destructive">
						{changes === 1 ? "1 uncommitted change" : `${changes} uncommitted changes`} in it will be lost.
					</p>
				)}
				{changes === null && <p className="text-sm text-muted-foreground">Git could not say what this folder holds, so it is left alone.</p>}
				{error && (
					<p id="remove-workspace-error" role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="ghost" size="sm" disabled={removing} onClick={onClose}>
						Keep
					</Button>
					<Button id="remove-workspace-confirm" variant="destructive" size="sm" disabled={removing || typeof changes !== "number"} onClick={run}>
						{(removing || changes === undefined) && <Spinner />}
						Remove
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
