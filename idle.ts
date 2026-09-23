/**
 * Which folders the server can let go of now: no tab looking at them, the
 * agent not in the middle of a turn there, and nobody having looked for
 * `idleMs` — since a tab was last attached or heard from, or a turn last
 * ended, whichever was later. A folder is cheap to make again (its session
 * and indexes, a few milliseconds) and a turn is not, so the rule lets go
 * only of what nobody is using and nothing is doing. Pure, so the rule is
 * tested without a server.
 */
export type Idleness = { busy: boolean; watched: number; since: number };

export function idleFolders(folders: Iterable<[string, Idleness]>, { now, idleMs }: { now: number; idleMs: number }): string[] {
	const out: string[] = [];
	for (const [folder, { busy, watched, since }] of folders) {
		if (!busy && watched === 0 && now - since >= idleMs) out.push(folder);
	}
	return out;
}
