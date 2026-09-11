/**
 * `[[a note]]` and `[[a note|shown as]]`, as the markdown parser sees them.
 *
 * Wikilinks are not CommonMark, so the parser that draws the note does not
 * know them. This teaches it, the way lezer means it to be taught — an
 * inline parser installed before the ordinary Link — rather than matching
 * `[[` with a pattern over the text: the parser knows what is code and what
 * is prose, so a `[[` inside a fence is not a link, and everything that
 * reads the tree — the highlighter, the decorations, the completion, the
 * index on the server — agrees on where the links are.
 *
 * Shared by both ends like protocol.ts. Depends on @lezer/markdown alone.
 */
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import { styleTags, Tag, tags } from "@lezer/highlight";

export const wikiLinkTag = Tag.define(tags.link);

const OPEN = "[".charCodeAt(0);
const CLOSE = "]".charCodeAt(0);
const PIPE = "|".charCodeAt(0);
const NL = "\n".charCodeAt(0);

/** A link that reaches the end of the section unclosed is text, as in Obsidian. */
function parseWikiLink(cx: InlineContext, next: number, pos: number): number {
	if (next !== OPEN || cx.char(pos + 1) !== OPEN) return -1;
	let end = pos + 2;
	let pipe = -1;
	for (; end < cx.end; end++) {
		const ch = cx.char(end);
		if (ch === NL) return -1;
		if (ch === CLOSE && cx.char(end + 1) === CLOSE) break;
		if (ch === PIPE && pipe === -1) pipe = end;
		// A nested opener means the outer one was not a link.
		if (ch === OPEN && cx.char(end + 1) === OPEN) return -1;
	}
	if (end >= cx.end) return -1;
	const targetEnd = pipe === -1 ? end : pipe;
	if (targetEnd === pos + 2) return -1; // `[[]]` is nothing.
	const children = [
		cx.elt("WikiLinkMark", pos, pos + 2),
		cx.elt("WikiLinkTarget", pos + 2, targetEnd),
		...(pipe === -1 ? [] : [cx.elt("WikiLinkMark", pipe, pipe + 1), cx.elt("WikiLinkAlias", pipe + 1, end)]),
		cx.elt("WikiLinkMark", end, end + 2),
	];
	return cx.addElement(cx.elt("WikiLink", pos, end + 2, children));
}

export const wikiLink: MarkdownConfig = {
	defineNodes: [
		{ name: "WikiLink", style: wikiLinkTag },
		{ name: "WikiLinkMark", style: tags.processingInstruction },
		{ name: "WikiLinkTarget" },
		{ name: "WikiLinkAlias" },
	],
	parseInline: [{ name: "WikiLink", parse: parseWikiLink, before: "Link" }],
	props: [styleTags({ WikiLink: wikiLinkTag, WikiLinkMark: tags.processingInstruction })],
};
