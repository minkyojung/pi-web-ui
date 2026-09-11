/**
 * Which note a link means, and which notes link to a note.
 *
 * A link names a note by title — the file's name without the folder and the
 * extension — or by a path with folders. When a title is in more than one
 * folder, the nearest to the note doing the linking wins, as in Obsidian. A
 * link to a note that does not exist is kept as such: it is a note waiting
 * to be written, and the editor draws it that way.
 *
 * The index is derived — every note's links, found with the same parser the
 * editor uses — and lives in a sidecar that can be thrown away and rebuilt
 * from the notes. Nothing here touches the disk; the server does.
 */
import { parser as markdown } from "@lezer/markdown";
import { titleOf } from "./naming.ts";
import { wikiLink } from "./wikilink.ts";

const parser = markdown.configure([wikiLink]);

export type Link = { target: string; alias: string | null; from: number; to: number };

/** Every wikilink in a note, in order, with where it sits. */
export function linksIn(text: string): Link[] {
	const out: Link[] = [];
	parser.parse(text).iterate({
		enter: (node) => {
			if (node.name !== "WikiLink") return;
			let target = "";
			let alias: string | null = null;
			for (let c = node.node.firstChild; c; c = c.nextSibling) {
				if (c.name === "WikiLinkTarget") target = text.slice(c.from, c.to).trim();
				if (c.name === "WikiLinkAlias") alias = text.slice(c.from, c.to).trim();
			}
			out.push({ target, alias, from: node.from, to: node.to });
			return false;
		},
	});
	return out;
}

/** How many folders two paths do not share: the distance a nearest-wins rule measures. */
function distance(a: string, b: string): number {
	const x = a.split("/").slice(0, -1);
	const y = b.split("/").slice(0, -1);
	let shared = 0;
	while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
	return x.length - shared + (y.length - shared);
}

/**
 * The note `target` means from the note at `from`, or null if there is none.
 *
 * `target` is a title, matched to the file's name without regard to case,
 * or a path with folders (with or without `.md`), matched whole.
 */
export function resolve(target: string, paths: Iterable<string>, from = ""): string | null {
	const want = target.trim().replace(/\.md$/i, "");
	if (!want) return null;
	const all = [...paths];
	if (want.includes("/")) {
		const whole = all.find((p) => p.replace(/\.md$/, "").toLowerCase() === want.toLowerCase());
		return whole ?? null;
	}
	const byTitle = all.filter((p) => titleOf(p).toLowerCase() === want.toLowerCase());
	if (byTitle.length === 0) return null;
	byTitle.sort((a, b) => distance(from, a) - distance(from, b) || a.localeCompare(b));
	return byTitle[0];
}

/** Each note's links, by path — what the sidecar holds. */
export type LinkIndex = Record<string, Link[]>;

/** Notes whose links resolve to `path`, with the links themselves, for the backlinks list. */
export function backlinksOf(index: LinkIndex, path: string, paths: Iterable<string>): { path: string; links: Link[] }[] {
	const all = [...paths];
	const out: { path: string; links: Link[] }[] = [];
	for (const [source, links] of Object.entries(index)) {
		if (source === path) continue;
		const hits = links.filter((l) => resolve(l.target, all, source) === path);
		if (hits.length) out.push({ path: source, links: hits });
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * A note's text with every link to `from` now pointing at `to`, or null if
 * nothing pointed there. What a rename writes into the notes that linked to
 * the renamed one. `paths` is the vault as it was before the rename — with
 * `from`, without `to` — since that is what the old links resolved against.
 * The alias, if any, is kept: it was chosen for the reader.
 */
export function retarget(text: string, from: string, to: string, paths: Iterable<string>, at: string): string | null {
	const before = [...paths];
	const links = linksIn(text).filter((l) => resolve(l.target, before, at) === from);
	if (links.length === 0) return null;
	// Point at the new note the way the old link did: by title if that alone
	// finds it in the vault as it is now, else by path.
	const after = [...before.filter((p) => p !== from), to];
	const title = titleOf(to);
	const name = resolve(title, after, at) === to ? title : to.replace(/\.md$/, "");
	let out = "";
	let last = 0;
	for (const l of links) {
		out += text.slice(last, l.from) + `[[${name}${l.alias === null ? "" : `|${l.alias}`}]]`;
		last = l.to;
	}
	return out + text.slice(last);
}
