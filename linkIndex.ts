/**
 * The vault's links, kept so that "who links here" is a lookup.
 *
 * Every note's links, found by the parser, in memory and in a sidecar under
 * .pi/ that is only a cache: missing or stale, it is rebuilt from the notes
 * at startup, which is a read of every note once. Kept current by the
 * server after every write it hears of — its own, pi's, the watcher's —
 * and moved with a rename, dropped with a delete.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { backlinksOf, type Link, type LinkIndex, linksIn, resolve } from "./links.ts";
import { listNotes, readNote } from "./vault.ts";

export const LINKS_PATH = ".pi/links.json";

export type Backlink = { path: string; count: number };

export class LinkStore {
	private index: LinkIndex = {};
	private root: string;

	// Not a parameter property: Node runs the tests with types stripped, which does not do those.
	constructor(root: string) {
		this.root = root;
	}

	/** From the sidecar if it agrees with the folder, else from the notes. */
	load(): void {
		const file = join(this.root, LINKS_PATH);
		const paths = listNotes(this.root).map((f) => f.path);
		try {
			const saved = JSON.parse(readFileSync(file, "utf8")) as LinkIndex;
			const same = Object.keys(saved).length === paths.length && paths.every((p) => p in saved);
			if (same) {
				this.index = saved;
				return;
			}
		} catch {
			// No sidecar, or not one this can read. The notes are the truth.
		}
		this.index = {};
		for (const path of paths) {
			const note = readNote(this.root, path);
			if (note) this.index[path] = linksIn(note.text);
		}
		this.save();
	}

	private save(): void {
		const file = join(this.root, LINKS_PATH);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(this.index));
	}

	paths(): string[] {
		return Object.keys(this.index);
	}

	linksOf(path: string): Link[] {
		return this.index[path] ?? [];
	}

	/** A note's text changed. Returns the notes whose backlinks may have changed: the old targets and the new. */
	update(path: string, text: string): string[] {
		const before = this.index[path] ?? [];
		const after = linksIn(text);
		this.index[path] = after;
		this.save();
		return this.targetsOf([...before, ...after], path);
	}

	remove(path: string): string[] {
		const had = this.index[path] ?? [];
		delete this.index[path];
		this.save();
		return this.targetsOf(had, path);
	}

	rename(from: string, to: string): void {
		if (from === to || !(from in this.index)) return;
		this.index[to] = this.index[from];
		delete this.index[from];
		this.save();
	}

	backlinks(path: string): Backlink[] {
		return backlinksOf(this.index, path, this.paths()).map((b) => ({ path: b.path, count: b.links.length }));
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
