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
import { listOf, propertiesOf, textValues, withProperties } from "./properties.ts";
import { parser } from "./syntax.ts";
import { isTagName } from "./tag.ts";

export type Link = {
	target: string;
	/** The heading after `#`, which says where in the note, not which note. */
	heading: string | null;
	/** The block id after `#^` or `^`, likewise. */
	block: string | null;
	alias: string | null;
	/**
	 * The property it was written in, when it was written in one rather than
	 * in the note's text. A rename rewrites the text's links by splicing the
	 * new name in; one in a property is inside a YAML value, where that is not
	 * safe, so the two are told apart here.
	 */
	property?: string;
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
export const LINKS_VERSION = 6;

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

/**
 * Every wikilink written in one of the note's properties, with which
 * property it was written in.
 *
 * A property holds a link the way Obsidian has it: as text — `related:
 * "[[Other]]"`. Unquoted, `[[Other]]` is not a link at all but a list inside
 * a list, which is what YAML makes of it, so nothing is read there. Each
 * value is read by the same parser the note's text is, so a link is one
 * thing here and there: the heading, the block and the alias are read the
 * same way, and a rename finds the same links this does (retarget).
 */
function frontMatterLinks(text: string): Link[] {
	const out: Link[] = [];
	for (const said of textValues(text)) {
		// The value, not the source it is written in: `"[[He said \"hi\"]]"` names
		// a note with a quote in its name, and only the value says so. The place
		// is then the value's — a link inside YAML has no place of its own in the
		// note once the quoting is undone, and nothing needs it to have one.
		for (const found of wikiLinksIn(said.value)) {
			out.push({ ...found.link, property: said.name, from: said.from, to: said.to });
		}
	}
	return out;
}

/** Every wikilink in a note, in order, with where it sits: the text's first, then the properties'. */
export function linksIn(text: string): Link[] {
	return [...wikiLinksIn(text).map((l) => l.link), ...frontMatterLinks(text)];
}

/**
 * The tags of a note, each once, as Obsidian keeps them: without the `#`,
 * and in lower case, since `#Todo` and `#todo` are one tag. Written in the
 * note or named in its `tags` property — the same list either way.
 */
export function tagsIn(text: string): string[] {
	const out = new Set<string>();
	parser.parse(text).iterate({
		enter: (node) => {
			if (node.name !== "Tag") return;
			out.add(text.slice(node.from + 1, node.to).toLowerCase());
			return false;
		},
	});
	// A tag named in the `tags` property is the same tag as one written in the
	// note: `tags: [reading]` and `#reading` put the note in one list, as
	// Obsidian's getAllTags does. The `#` a person may still put in front is
	// not part of the name (properties.ts), and what is left must be a name a
	// tag could have — `2024` is a year here as it is there (tag.ts).
	const read = propertiesOf(text);
	if (read.block && read.errors.length === 0) {
		for (const name of listOf(read.doc, "tags")) if (isTagName(name)) out.add(name.toLowerCase());
	}
	return [...out];
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
 * A note with every link to `from` now pointing at `to`, or null if nothing
 * pointed there. What a rename writes into the notes that linked to the
 * renamed one. `paths` is the vault as it was before the rename — with
 * `from`, without `to` — since that is what the old links resolved against.
 * Only the note's name is rewritten: the heading or block after it and the
 * alias still say what they said, and the alias was chosen for the reader.
 *
 * Links written in the properties follow too, since they are links
 * (linksIn), but not the same way: the text is spliced and a property is
 * written through the document. See inProperties.
 */
export function retarget(text: string, from: string, to: string, paths: Iterable<string>, at: string): string | null {
	const before = [...paths];
	const wants = (target: string) => resolve(target, before, at) === from;
	// Point at the new note the way the old link did: by title if that alone
	// finds it in the vault as it is now, else by path.
	const after = [...before.filter((p) => p !== from), to];
	const title = titleOf(to);
	const name = resolve(title, after, at) === to ? title : to.replace(/\.md$/, "");

	const links = wikiLinksIn(text).filter((l) => wants(l.link.target));
	let out = text;
	if (links.length > 0) {
		out = "";
		let last = 0;
		for (const l of links) {
			out += text.slice(last, l.name.from) + name;
			last = l.name.to;
		}
		out += text.slice(last);
	}
	// The note's text first, then its properties: writing the block moves
	// everything under it, and the text's places were read before that.
	const said = inProperties(out, wants, name);
	return said ?? (links.length > 0 ? out : null);
}

/**
 * The note with every link to the renamed note, written in a property, now
 * naming it by `name` — or null when no property named it.
 *
 * The value is put back through the document (properties.ts) and not spliced
 * into the note: it sits inside YAML, where a name with a quote or a colon
 * in it would end the value early and take the block with it. What needs
 * quoting is the library's to decide; what the value says around the link —
 * the words, the other links — is copied as it was, and so are the note's
 * other properties. A block that does not parse is left alone, as ever.
 */
function inProperties(text: string, wants: (target: string) => boolean, name: string): string | null {
	const said = textValues(text).filter((v) => wikiLinksIn(v.value).some((l) => wants(l.link.target)));
	if (said.length === 0) return null;
	const edited = withProperties(text, (doc) => {
		for (const value of said) doc.setIn(value.at, renamed(value.value, wants, name));
	});
	return edited.ok ? edited.text : null;
}

/** One value with the links that point at the renamed note now naming it by `name`; the rest of it as it was. */
function renamed(value: string, wants: (target: string) => boolean, name: string): string {
	let out = "";
	let last = 0;
	for (const l of wikiLinksIn(value)) {
		if (!wants(l.link.target)) continue;
		out += value.slice(last, l.name.from) + name;
		last = l.name.to;
	}
	return out + value.slice(last);
}
