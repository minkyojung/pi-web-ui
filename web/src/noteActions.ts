import { hashForNote, wholePath } from "./noteSync";
import { configStore } from "./serverState";
import { send } from "./ws";

/**
 * What can be done to a note, wherever it is offered from.
 *
 * Two menus offer it — the header's ⋯ and a right click in the list — and the
 * two are different Radix primitives, so the drawing cannot be shared. The
 * deciding can, and has to be: the last thing that went wrong here was a Copy
 * Path in each place answering differently because nothing held them together.
 *
 * Nothing in here knows which note is open, which is why it works from the
 * list as well as from the header. Renaming goes through the address, the way
 * every other opening in this window does, and lands on the title — which is
 * the field you rename by, open or not.
 */
export type NoteAction = { label: string; needsServer?: boolean; destructive?: boolean; run: () => void };

/** The shell's bridge, absent in a browser tab; the Finder is not a page's to open. */
const shell = (window as { pi?: { reveal(path: string): Promise<void> } }).pi;

export function noteActions(path: string): (NoteAction | "separator")[] {
	const whole = () => wholePath(configStore.get()?.folder, path);
	return [
		{
			label: "Rename",
			needsServer: true,
			run: () => {
				// Open it first: the title is the note's own field, and a note that
				// is not in front does not have one on screen to put the caret in.
				location.hash = hashForNote(path);
				// After the menu has closed and the note has been drawn, or the
				// focus goes back where Radix had it.
				requestAnimationFrame(() => {
					const box = document.querySelector<HTMLInputElement>("#title");
					box?.focus();
					box?.select();
				});
			},
		},
		{ label: "Copy path", run: () => void navigator.clipboard?.writeText(whole()) },
		...(shell ? [{ label: "Reveal in Finder", run: () => void shell.reveal(whole()) }] : []),
		"separator",
		// To the trash, not gone: the column offers Restore afterwards, so there
		// is nothing to confirm here.
		{ label: "Delete", needsServer: true, destructive: true, run: () => send({ type: "delete_note", path }) },
	];
}
