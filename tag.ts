/**
 * `#tag`, as the markdown parser sees it.
 *
 * Taught the way lezer teaches a bare URL (its Autolink): an inline parser
 * that looks at the word starting here and takes it whole. A tag is a `#`
 * after a space or at the start, then letters, digits, `_`, `-` and `/`,
 * with at least one that is not a digit — Obsidian's rule, which keeps `#1`
 * and `#2024` from being tags. `# heading` is not one, the `#` being
 * followed by a space; nor is a `#` inside a word, a URL or code, since the
 * parser gets there first or never comes.
 *
 * Shared by both ends like wikilink.ts. Indexing tags is another day's
 * work; this only says where they are.
 */
import { styleTags, Tag } from "@lezer/highlight";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

export const tagTag = Tag.define();

const HASH = "#".charCodeAt(0);
/** What a tag is made of, in one place: the inline parser matches it, and a tag written as a property is held to it. */
const CHARS = "[\\p{L}\\p{N}_\\-/]+";
const tagRE = new RegExp(`#(${CHARS})`, "uy");
const nameRE = new RegExp(`^${CHARS}$`, "u");

/**
 * Whether a name may stand after the `#`: letters, digits, `_`, `-` and `/`,
 * with at least one that is not a digit, so that `2024` is a year and not a
 * tag — Obsidian's rule. A tag written in a property has no `#` in front of
 * it and is held to the same rule (links.ts).
 */
export const isTagName = (name: string) => nameRE.test(name) && /[^\p{N}]/u.test(name);

function parseTag(cx: InlineContext, next: number, absPos: number): number {
	if (next !== HASH) return -1;
	const pos = absPos - cx.offset;
	if (pos > 0 && !/\s/.test(cx.text[pos - 1])) return -1;
	tagRE.lastIndex = pos;
	const m = tagRE.exec(cx.text);
	if (!m || !isTagName(m[1])) return -1;
	return cx.addElement(cx.elt("Tag", absPos, absPos + m[0].length, [cx.elt("TagMark", absPos, absPos + 1)]));
}

export const tag: MarkdownConfig = {
	defineNodes: [
		{ name: "Tag", style: { "Tag/...": tagTag } },
		{ name: "TagMark" },
	],
	parseInline: [{ name: "Tag", parse: parseTag }],
	props: [styleTags({ "Tag/...": tagTag })],
};
