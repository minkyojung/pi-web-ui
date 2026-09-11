import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";

import { renameTarget, titleOf } from "../noteSync";
import { flushSaves } from "../saves";
import { noteRenameFailedStore } from "../serverState";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const REASONS = {
	exists: "A note with that name already exists.",
	missing: "This note is no longer there.",
	invalid: "That is not a name a note can have.",
} as const;

/**
 * The note's name, which is its title — one thing, not two.
 *
 * The file's name is what the title shows and what changing the title
 * changes, as in Obsidian: the file is the truth, and the truth already has a
 * name. Nothing happens while the name is being typed; Enter or leaving the
 * field asks the server to move the note, and Escape puts the old name back.
 * Whatever was typed in the body goes down first, on the old path, before the
 * path moves. A slash in the name is a folder — `ideas/name` under this
 * note's folder, `/name` at the top — so moving a note is renaming it.
 *
 * Uncontrolled like the composer, and keyed on the path so a rename from
 * anywhere — this field, another tab — resets what it shows.
 */
export function Title({ path }: { path: string }) {
	const box = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);

	const failed = useSyncExternalStore(noteRenameFailedStore.subscribe, noteRenameFailedStore.get);
	useEffect(() => {
		if (!failed || failed.path !== path) return;
		noteRenameFailedStore.set(null);
		setError(REASONS[failed.reason]);
		box.current?.focus();
	}, [failed, path]);

	const commit = () => {
		const name = box.current?.value ?? "";
		if (name.trim() === titleOf(path)) {
			reset();
			return;
		}
		const target = renameTarget(path, name);
		if ("error" in target) {
			setError(target.error);
			return;
		}
		// A path can name where the note already is (`/name` at the top), and
		// the field, keyed on the path, would otherwise keep showing what was typed.
		if (target.to === path) {
			reset();
			return;
		}
		setError(null);
		flushSaves();
		send({ type: "rename_note", path, to: target.to });
	};
	const reset = () => {
		if (box.current) box.current.value = titleOf(path);
		setError(null);
	};

	return (
		<div className="drag-region flex h-11 shrink-0 items-center gap-3 border-b px-6">
			<input
				key={path}
				ref={box}
				id="title"
				type="text"
				defaultValue={titleOf(path)}
				aria-label="Title"
				aria-invalid={error ? true : undefined}
				spellCheck={false}
				className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
				placeholder="Untitled"
				onKeyDown={(e) => {
					if (e.nativeEvent.isComposing) return;
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
						e.currentTarget.blur();
					} else if (e.key === "Escape") {
						e.preventDefault();
						reset();
						e.currentTarget.blur();
					}
				}}
				onBlur={commit}
			/>
			{error && (
				<span role="alert" className="shrink-0 text-xs text-destructive">
					{error}
				</span>
			)}
			{/* To the trash, not gone: the column offers Restore afterwards, so
			    there is nothing to confirm here. */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						aria-label="Delete note"
						className="h-7 w-7 shrink-0 p-0 text-muted-foreground"
						onClick={() => send({ type: "delete_note", path })}
					>
						<Trash2 className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">Delete</TooltipContent>
			</Tooltip>
		</div>
	);
}
