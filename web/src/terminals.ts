/**
 * The row of terminals under the note: which are there is the server's to
 * say (/api/terminals — the shells live there), and only which one is in
 * front is this window's, kept beside the note tabs.
 *
 * Ids are numbers as strings, given out by the page: the next is one past
 * the highest there is, so a closed terminal's number is not handed to a
 * new one while any older one is still open, and a tab called `zsh 2` stays
 * `zsh 2`. Pure, but for the two that read and write the browser.
 */
import { keyFor } from "./workspace.ts";

export type TerminalInfo = { id: string; shell: string };

/** The id for a new terminal, past every one there is. */
export function nextId(ids: string[]): string {
	let highest = 0;
	for (const id of ids) {
		const n = Number(id);
		if (Number.isInteger(n) && n > highest) highest = n;
	}
	return String(highest + 1);
}

/** What a tab is called: the shell and the number, as VS Code names them. */
export const nameOf = ({ id, shell }: TerminalInfo): string => `${shell} ${id}`;

/** Which is in front once `id` is gone: the one that was, or the neighbour on the right, else the left. */
export function frontAfter(ids: string[], gone: string, front: string | null): string | null {
	if (front !== gone) return front !== null && ids.includes(front) ? front : null;
	const at = ids.indexOf(gone);
	if (at === -1) return null;
	return ids[at + 1] ?? ids[at - 1] ?? null;
}

const KEY = () => keyFor("terminal-front");

export function readFront(): string | null {
	try {
		return localStorage.getItem(KEY());
	} catch {
		return null;
	}
}

export function writeFront(id: string | null): void {
	try {
		if (id === null) localStorage.removeItem(KEY());
		else localStorage.setItem(KEY(), id);
	} catch {
		// Storage blocked: the first terminal is in front next time, which is all that is lost.
	}
}
