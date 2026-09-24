import { useEffect, useState } from "react";

import { toast } from "sonner";

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/spinner";

/** The shell's side: how many uncommitted changes a workspace holds, and the archiving. See preload.cjs `workspaces`. */
export interface Archiving {
	changes(path: string): Promise<number | null>;
	archive(path: string, seen: number): Promise<{ error?: string; changes?: number; warning?: string } | null>;
}

/**
 * Asked before a workspace is archived, since its folder is given back: what
 * goes and what stays — the branch and its commits, the conversation, and the
 * row, which is why it can be brought back — and, when the folder holds
 * changes no commit has, how many would go with it, that being the one thing
 * archiving does not keep. The shell is told the number that was read here,
 * and archives nothing if the folder holds another by then: the new number is
 * shown instead, to be read and asked about again (electron/main.js
 * archiveWorkspace).
 */
export function ArchiveWorkspace({ workspace, onClose, shell }: { workspace: { path: string; branch: string } | null; onClose: () => void; shell: Archiving }) {
	// Undefined while git is asked; null when it could not say.
	const [changes, setChanges] = useState<number | null | undefined>(undefined);
	const [archiving, setArchiving] = useState(false);
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
		setArchiving(true);
		setError(null);
		shell
			.archive(workspace.path, changes)
			.then((result) => {
				if (result?.error) setError(result.error);
				else if (typeof result?.changes === "number") setChanges(result.changes);
				else {
					// Archived: what the repository's own archive command said, if it failed, is said after.
					if (result?.warning) toast.warning(result.warning);
					onClose();
				}
			})
			.catch((err: Error) => setError(err.message))
			.finally(() => setArchiving(false));
	};

	return (
		<Dialog open={workspace !== null} onOpenChange={(next) => !next && !archiving && onClose()}>
			<DialogContent id="archive-workspace" className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Archive {workspace?.branch}?</DialogTitle>
					<DialogDescription>Its folder is given back. The branch and its commits stay, and so does the conversation — Settings › Archived brings it back.</DialogDescription>
				</DialogHeader>
				{typeof changes === "number" && changes > 0 && (
					<p id="archive-workspace-changes" className="text-sm text-destructive">
						{changes === 1 ? "1 uncommitted change" : `${changes} uncommitted changes`} in it will be lost.
					</p>
				)}
				{changes === null && <p className="text-sm text-subtle-foreground">Git could not say what this folder holds, so it is left alone.</p>}
				{error && (
					<p id="archive-workspace-error" role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="ghost" size="sm" disabled={archiving} onClick={onClose}>
						Keep
					</Button>
					<Button id="archive-workspace-confirm" variant="destructive" size="sm" disabled={archiving || typeof changes !== "number"} onClick={run}>
						{(archiving || changes === undefined) && <Spinner />}
						Archive
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
