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
import type { SyntaxNode } from "@lezer/common";
import { titleOf } from "./naming.ts";
import { parser } from "./syntax.ts";

export type Link = {
	target: string;
	/** The heading after `#`, which says where in the note, not which note. */
	heading: string | null;
	/** The block id after `#^` or `^`, likewise. */
	block: string | null;
	alias: string | null;
	from: number;
	to: number;
};

/** Where inside its note a link points: a heading, a block, or neither. */
export type Place = Pick<Link, "heading" | "block">;

/**
 * Which links linksIn finds, as a number. The sidecar is written with it, so
 * a sidecar built when the parser found links differently is rebuilt rather
 * than trusted. Bump it with any change to what linksIn returns for a note.
 */
export const LINKS_VERSION = 4;

/**
 * A WikiLink node read as a link, and where the note's name sits in it —
 * which is all a rename rewrites. Shared with the editor, which has the tree
 * already and reads it the same way.
 */
export function readWikiLink(node: SyntaxNode, slice: (from: number, to: number) => string): { link: Link; name: { from: number; to: number } } {
	const link: Link = { target: "", heading: null, block: null, alias: null, from: node.from, to: node.to };
	let name = { from: node.from, to: node.from };
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (c.name === "WikiLinkTarget") {
			const place = c.getChild("WikiLinkHeading") ?? c.getChild("WikiLinkBlock");
			name = { from: c.from, to: place ? place.from : c.to };
			link.target = slice(name.from, name.to).trim();
			if (place) {
				// After the mark — `#`, `#^` or `^`. An empty one names no place: `[[a#]]` is `[[a]]`.
				const text = slice(place.firstChild!.to, place.to).trim() || null;
				if (place.name === "WikiLinkHeading") link.heading = text;
				else link.block = text;
			}
		}
		if (c.name === "WikiLinkAlias") link.alias = slice(c.from, c.to).trim();
	}
	return { link, name };
}

function wikiLinksIn(text: string): ReturnType<typeof readWikiLink>[] {
	const out: ReturnType<typeof readWikiLink>[] = [];
	const slice = (from: number, to: number) => text.slice(from, to);
	parser.parse(text).iterate({
		enter: (node) => {
			if (node.name !== "WikiLink") return;
			out.push(readWikiLink(node.node, slice));
			return false;
		},
	});
	return out;
}

/** Every wikilink in a note, in order, with where it sits. */
export function linksIn(text: string): Link[] {
	return wikiLinksIn(text).map((l) => l.link);
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
 * or a path with folders (with or without `.md`), matched whole. No name at
 * all — `[[#a heading]]` — is the note doing the linking, as in Obsidian.
 */
export function resolve(target: string, paths: Iterable<string>, from = ""): string | null {
	const want = target.trim().replace(/\.md$/i, "");
	const all = [...paths];
	if (!want) return from && all.includes(from) ? from : null;
	if (want.includes("/")) {
		const whole = all.find((p) => p.replace(/\.md$/, "").toLowerCase() === want.toLowerCase());
		return whole ?? null;
	}
	const byTitle = all.filter((p) => titleOf(p).toLowerCase() === want.toLowerCase());
	if (byTitle.length === 0) return null;
	byTitle.sort((a, b) => distance(from, a) - distance(from, b) || a.localeCompare(b));
	return byTitle[0];
}

/**
 * Where an ordinary markdown link — `[words](url)` — goes from the note at
 * `from`: a note in the vault, a web address, or nowhere this app can go.
 *
 * A path is a path, not a title: from the note's folder, or from the top of
 * the vault when it starts with `/`, and never out of the vault. Its
 * `#fragment` is dropped and its `%20`s decoded, as other editors write them.
 * Such links are followed but not indexed; the index is the wikilinks'.
 */
export function markdownLinkTo(url: string, paths: Iterable<string>, from: string): { note: string } | { web: string } | null {
	let raw = url.trim();
	if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1);
	if (/^https?:\/\//i.test(raw)) return { web: raw };
	if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // mailto:, file: and the rest are not this app's to open.
	const hash = raw.indexOf("#");
	if (hash !== -1) raw = raw.slice(0, hash);
	let path: string;
	try {
		path = decodeURIComponent(raw);
	} catch {
		return null;
	}
	if (!path.toLowerCase().endsWith(".md")) return null;
	const parts = path.startsWith("/") ? [] : from.split("/").slice(0, -1);
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part !== "..") parts.push(part);
		else if (parts.pop() === undefined) return null;
	}
	const want = parts.join("/").toLowerCase();
	const found = [...paths].find((p) => p.toLowerCase() === want);
	return found ? { note: found } : null;
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
 * Only the note's name is rewritten: the heading or block after it and the
 * alias still say what they said, and the alias was chosen for the reader.
 */
export function retarget(text: string, from: string, to: string, paths: Iterable<string>, at: string): string | null {
	const before = [...paths];
	const links = wikiLinksIn(text).filter((l) => resolve(l.link.target, before, at) === from);
	if (links.length === 0) return null;
	// Point at the new note the way the old link did: by title if that alone
	// finds it in the vault as it is now, else by path.
	const after = [...before.filter((p) => p !== from), to];
	const title = titleOf(to);
	const name = resolve(title, after, at) === to ? title : to.replace(/\.md$/, "");
	let out = "";
	let last = 0;
	for (const l of links) {
		out += text.slice(last, l.name.from) + name;
		last = l.name.to;
	}
	return out + text.slice(last);
}
