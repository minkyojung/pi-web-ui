/**
 * The vault's links and tags, kept so that "who links here" and "what else
 * carries this tag" are lookups.
 *
 * Every note's links and tags, found by the parser, in memory and in a sidecar under
 * .pi/ that is only a cache: missing or stale, it is rebuilt from the notes
 * at startup, which is a read of every note once. Kept current by the
 * server after every write it hears of — its own, pi's, the watcher's —
 * and moved with a rename, dropped with a delete.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { backlinksOf, type Link, type LinkIndex, LINKS_VERSION, linksIn, resolve, tagsIn } from "./links.ts";
import { listNotes, readNote } from "./vault.ts";

export const LINKS_PATH = ".pi/links.json";

/**
 * The index with the version of linksIn that built it. A sidecar that agrees
 * with the folder can still be wrong, if the parser has learned since what a
 * link is — a heading after `#` was once part of the name — so both must agree.
 */
type Sidecar = { version: number; notes: LinkIndex; tags: Record<string, string[]> };

export type Backlink = { path: string; count: number };
/** Another note that shares a tag with this one, and which. */
export type Tagged = { path: string; tags: string[] };
/** After a change: the notes whose backlinks, and whose tagged lists, may now differ. */
export type Touched = { backlinks: string[]; tagged: string[] };

export class LinkStore {
	private index: LinkIndex = {};
	private tags: Record<string, string[]> = {};
	private root: string;

	// Not a parameter property: Node runs the tests with types stripped, which does not do those.
	constructor(root: string) {
		this.root = root;
	}

	/** From the sidecar if it agrees with the folder and the parser, else from the notes. */
	load(): void {
		const file = join(this.root, LINKS_PATH);
		const paths = listNotes(this.root).map((f) => f.path);
		try {
			const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<Sidecar>;
			const notes = saved.version === LINKS_VERSION ? saved.notes : undefined;
			const tags = saved.tags;
			if (notes && tags && Object.keys(notes).length === paths.length && paths.every((p) => p in notes && p in tags)) {
				this.index = notes;
				this.tags = tags;
				return;
			}
		} catch {
			// No sidecar, or not one this can read. The notes are the truth.
		}
		this.index = {};
		this.tags = {};
		for (const path of paths) {
			const note = readNote(this.root, path);
			if (!note) continue;
			this.index[path] = linksIn(note.text);
			this.tags[path] = tagsIn(note.text);
		}
		this.save();
	}

	private save(): void {
		const file = join(this.root, LINKS_PATH);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify({ version: LINKS_VERSION, notes: this.index, tags: this.tags } satisfies Sidecar));
	}

	paths(): string[] {
		return Object.keys(this.index);
	}

	linksOf(path: string): Link[] {
		return this.index[path] ?? [];
	}

	tagsOf(path: string): string[] {
		return this.tags[path] ?? [];
	}

	/**
	 * A note's text changed. Returns the notes whose backlinks may have
	 * changed — the old targets and the new — and those whose tagged lists
	 * may have: the note itself and every note sharing a tag it had or has.
	 */
	update(path: string, text: string): Touched {
		const before = this.index[path] ?? [];
		const after = linksIn(text);
		const hadTags = this.tags[path] ?? [];
		this.index[path] = after;
		this.tags[path] = tagsIn(text);
		this.save();
		return { backlinks: this.targetsOf([...before, ...after], path), tagged: this.sharing([...hadTags, ...this.tags[path]], path) };
	}

	remove(path: string): Touched {
		const had = this.index[path] ?? [];
		const hadTags = this.tags[path] ?? [];
		delete this.index[path];
		delete this.tags[path];
		this.save();
		return { backlinks: this.targetsOf(had, path), tagged: this.sharing(hadTags, path).filter((p) => p !== path) };
	}

	rename(from: string, to: string): void {
		if (from === to || !(from in this.index)) return;
		this.index[to] = this.index[from];
		this.tags[to] = this.tags[from] ?? [];
		delete this.index[from];
		delete this.tags[from];
		this.save();
	}

	backlinks(path: string): Backlink[] {
		return backlinksOf(this.index, path, this.paths()).map((b) => ({ path: b.path, count: b.links.length }));
	}

	/** The other notes that share a tag with `path`, by path, each with the tags shared. */
	tagged(path: string): Tagged[] {
		const mine = new Set(this.tags[path] ?? []);
		if (mine.size === 0) return [];
		const out: Tagged[] = [];
		for (const [other, tags] of Object.entries(this.tags)) {
			if (other === path) continue;
			const shared = tags.filter((t) => mine.has(t));
			if (shared.length) out.push({ path: other, tags: shared });
		}
		return out.sort((a, b) => a.path.localeCompare(b.path));
	}

	/** `path` and every note carrying any of `tags`: whose tagged lists a change to `path` may touch. */
	private sharing(tags: string[], path: string): string[] {
		const want = new Set(tags);
		const out = new Set<string>([path]);
		for (const [other, has] of Object.entries(this.tags)) if (has.some((t) => want.has(t))) out.add(other);
		return [...out];
	}

	/** The notes a set of links resolve to, each once, as paths — resolved or not. */
	private targetsOf(links: Link[], from: string): string[] {
		const out = new Set<string>();
		for (const l of links) out.add(resolveOrName(l.target, this.paths(), from));
		return [...out];
	}
}

/** A link's note if there is one, else the note it would be — so an unresolved link still names a target. */
function resolveOrName(target: string, paths: string[], from: string): string {
	return resolve(target, paths, from) ?? `${target.trim().replace(/\.md$/i, "")}.md`;
}
