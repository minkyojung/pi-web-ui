/**
 * Which notes the folder holds, in memory, so that the folder is not read
 * again to answer a question nothing asked.
 *
 * The list used to be made by walking the folder, and it was made again on
 * every save, every change the watcher saw, and every turn pi finished. A walk
 * is 21ms over two thousand notes and 267ms over fifty thousand, and this
 * server is one thread: for that long it answers nothing — not a note being
 * opened, not an event from pi. `LIMIT` in vault.ts was what kept that bearable,
 * and it sat at a number ordinary vaults pass.
 *
 * What the tabs use this list for is the set of paths: the tree, the quick
 * open, the `[[` completion, and whether the folder is empty at all. None of
 * them reads a note's mtime. So a note being written changes nothing they can
 * see, and the only news is a note appearing, going, or changing its name —
 * which the server already knows about at the moment it happens, from the
 * watcher or from its own hands. This holds that knowledge instead of throwing
 * it away and asking the disk again.
 *
 * Every method answers the same question — did the list change? — so the
 * server sends it on only when it did.
 *
 * Kept honest by walking again where it is cheap: at startup, when a tab
 * connects, and after pi settles, since a shell command can do anything to a
 * folder. That is the shape VS Code's explorer, Obsidian's vault index and
 * git's own index all have: events for the usual traffic, a re-read at a
 * moment nobody is typing.
 */
import { LIMIT, listFiles, type NoteFile } from "./vault.ts";

export class FileIndex {
	private notes = new Map<string, number>();
	/** The documents (documents.ts) beside the notes, by path. Listed so a message can name one; nothing orders them. */
	private docs = new Set<string>();
	private root: string;
	private cut = false;

	// Not a parameter property: Node runs the tests with types stripped, which does not do those.
	constructor(root: string) {
		this.root = root;
	}

	/** Read the folder. True when the set of notes is not what it was. */
	load(): boolean {
		const { notes: found, documents } = listFiles(this.root);
		const next = new Map(found.map((f) => [f.path, f.modified] as const));
		const docs = new Set(documents);
		const changed =
			next.size !== this.notes.size ||
			[...next.keys()].some((path) => !this.notes.has(path)) ||
			docs.size !== this.docs.size ||
			[...docs].some((path) => !this.docs.has(path));
		this.notes = next;
		this.docs = docs;
		// The walk stops at LIMIT, so a list that long is one that was cut. A
		// folder holding exactly that many notes reads as cut and is told so
		// wrongly — the cheap wrong answer, at a number no folder of notes
		// reaches, rather than a second return value through every caller.
		this.cut = found.length >= LIMIT;
		return changed;
	}

	/**
	 * A note was written or first seen. True only when it is one the list did
	 * not have: a note's text changing is not news to anything that reads this.
	 */
	saw(path: string, modified: number): boolean {
		const news = !this.notes.has(path);
		this.notes.set(path, modified);
		return news;
	}

	/** A note is gone. True when it was there to go. */
	remove(path: string): boolean {
		return this.notes.delete(path);
	}

	/** A note under a new name, keeping when it was last written. */
	rename(from: string, to: string): boolean {
		const modified = this.notes.get(from);
		if (modified === undefined) return this.saw(to, Date.now());
		this.notes.delete(from);
		this.notes.set(to, modified);
		return true;
	}

	has(path: string): boolean {
		return this.notes.has(path);
	}

	/** A document appeared, or went. True when that is news to the list. */
	sawDocument(path: string, there: boolean): boolean {
		if (there === this.docs.has(path)) return false;
		if (there) this.docs.add(path);
		else this.docs.delete(path);
		return true;
	}

	/** The documents, by path. */
	documents(): string[] {
		return [...this.docs].sort();
	}

	paths(): string[] {
		return this.all().map((f) => f.path);
	}

	/** Newest first, as the walk itself sorted them. */
	all(): NoteFile[] {
		return [...this.notes]
			.map(([path, modified]) => ({ path, modified }))
			.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
	}

	/** The folder held more notes than the walk would take. */
	get truncated(): boolean {
		return this.cut;
	}
}
