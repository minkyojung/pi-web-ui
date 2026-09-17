/**
 * What the vault's notes call their properties, and what they put in them,
 * so that a box can offer what is already there.
 *
 * Every note's properties, read by the same reader the panel reads with
 * (properties.ts), in memory. Built at startup from the notes — one pass —
 * and kept current by the server after every write it hears of, the way the
 * link index is. No sidecar: what this holds is a few names and the words
 * under them, cheap to make again, and a cache of it would be one more
 * thing that can be wrong.
 *
 * A type belongs to a name and so does a name's spelling: `Status` and
 * `status` are one property (propertyTypes.ts), gathered here under the
 * lower-case one and offered back in whichever spelling the notes use most.
 */
import { type Suggestions, writtenIn, type Written } from "./properties.ts";
import { keyOf } from "./propertyTypes.ts";
import { listNotes, readNote } from "./vault.ts";

export class PropertyStore {
	private notes: Record<string, Written[]> = {};
	private root: string;

	// Not a parameter property: Node runs the tests with types stripped, which does not do those.
	constructor(root: string) {
		this.root = root;
	}

	load(): void {
		this.notes = {};
		for (const { path } of listNotes(this.root)) {
			const note = readNote(this.root, path);
			if (note) this.notes[path] = writtenIn(note.text);
		}
	}

	/**
	 * A note's text changed. Returns whether what it says about properties is
	 * not what was held — which is when, and only when, the vault may have
	 * something new to offer. A note whose body alone changed says no.
	 */
	update(path: string, text: string): boolean {
		const now = writtenIn(text);
		const was = this.notes[path];
		this.notes[path] = now;
		return was === undefined ? now.length > 0 : JSON.stringify(was) !== JSON.stringify(now);
	}

	/** A note is gone. Returns whether it had anything to say. */
	remove(path: string): boolean {
		const had = this.notes[path];
		delete this.notes[path];
		return had !== undefined && had.length > 0;
	}

	/** A note moved. What the vault says is the same; only where it is said moves. */
	rename(from: string, to: string): void {
		if (from === to || !(from in this.notes)) return;
		this.notes[to] = this.notes[from];
		delete this.notes[from];
	}

	all(): Suggestions {
		const spellings = new Map<string, Map<string, number>>();
		const values = new Map<string, Map<string, number>>();
		for (const written of Object.values(this.notes)) {
			for (const { name, values: said } of written) {
				const key = keyOf(name);
				if (!key) continue;
				count(spellings, key, name);
				for (const value of said) count(values, key, value);
			}
		}
		const used = new Map<string, number>();
		for (const seen of spellings.values()) used.set(ranked(seen)[0], total(seen));
		return { names: ranked(used), values: Object.fromEntries([...values].map(([key, seen]) => [key, ranked(seen)])) };
	}
}

function count(tally: Map<string, Map<string, number>>, key: string, of: string): void {
	let seen = tally.get(key);
	if (!seen) tally.set(key, (seen = new Map()));
	seen.set(of, (seen.get(of) ?? 0) + 1);
}

const total = (seen: Map<string, number>) => [...seen.values()].reduce((a, b) => a + b, 0);

/** What was counted, the most counted first, and alike counts by name — so the same vault always offers the same order. */
const ranked = (seen: Map<string, number>) => [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([of]) => of);
