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
 * A link can point inside its note, as in Obsidian: `[[a note#a heading]]`,
 * or `[[a note#^an-id]]` for the block marked `^an-id` at the end of its
 * line. The target keeps that part as a node of its own, so what reads the
 * tree takes the note's name without cutting the text itself, and the
 * block's mark is a node too, so the block can be found the same way.
 *
 * `![[a note]]` is the same link, marked to be shown in place: a WikiEmbed
 * around the `!` and the WikiLink, so it is found, resolved and indexed as
 * one. Showing the note there is the reader's business, not the parser's.
 *
 * Shared by both ends like protocol.ts. Depends on @lezer/markdown alone.
 */
import type { Element, InlineContext, MarkdownConfig } from "@lezer/markdown";
import { styleTags, Tag, tags } from "@lezer/highlight";

export const wikiLinkTag = Tag.define(tags.link);

const OPEN = "[".charCodeAt(0);
const CLOSE = "]".charCodeAt(0);
const PIPE = "|".charCodeAt(0);
const BANG = "!".charCodeAt(0);
const HASH = "#".charCodeAt(0);
const CARET = "^".charCodeAt(0);
const DASH = "-".charCodeAt(0);
const NL = "\n".charCodeAt(0);
const SPACE = " ".charCodeAt(0);
const TAB = "\t".charCodeAt(0);

/**
 * The place inside the note that a target names, from its first `#` or `^`
 * on: a heading after `#`, a block after `#^` — or after `^` alone, which
 * Obsidian does not write but which names nothing else, since a note's name
 * cannot hold a `^`.
 */
function subpath(cx: InlineContext, from: number, to: number): Element[] {
	for (let i = from; i < to; i++) {
		const ch = cx.char(i);
		if (ch !== HASH && ch !== CARET) continue;
		const block = ch === CARET || cx.char(i + 1) === CARET;
		const markEnd = ch === HASH && block ? i + 2 : i + 1;
		return [cx.elt(block ? "WikiLinkBlock" : "WikiLinkHeading", i, to, [cx.elt("WikiLinkMark", i, markEnd)])];
	}
	return [];
}

/** The `[[…]]` starting at `pos`, or null. A link that reaches the end of the section unclosed is text, as in Obsidian. */
function wikiLinkAt(cx: InlineContext, pos: number): Element | null {
	if (cx.char(pos) !== OPEN || cx.char(pos + 1) !== OPEN) return null;
	let end = pos + 2;
	let pipe = -1;
	for (; end < cx.end; end++) {
		const ch = cx.char(end);
		if (ch === NL) return null;
		if (ch === CLOSE && cx.char(end + 1) === CLOSE) break;
		if (ch === PIPE && pipe === -1) pipe = end;
		// A nested opener means the outer one was not a link.
		if (ch === OPEN && cx.char(end + 1) === OPEN) return null;
	}
	if (end >= cx.end) return null;
	const targetEnd = pipe === -1 ? end : pipe;
	if (targetEnd === pos + 2) return null; // `[[]]` is nothing.
	const children = [
		cx.elt("WikiLinkMark", pos, pos + 2),
		cx.elt("WikiLinkTarget", pos + 2, targetEnd, subpath(cx, pos + 2, targetEnd)),
		...(pipe === -1 ? [] : [cx.elt("WikiLinkMark", pipe, pipe + 1), cx.elt("WikiLinkAlias", pipe + 1, end)]),
		cx.elt("WikiLinkMark", end, end + 2),
	];
	return cx.elt("WikiLink", pos, end + 2, children);
}

function parseWikiLink(cx: InlineContext, next: number, pos: number): number {
	const link = next === OPEN ? wikiLinkAt(cx, pos) : null;
	return link ? cx.addElement(link) : -1;
}

/**
 * `![[a note]]`: a link whose note is meant to be shown in place. The link
 * inside is an ordinary WikiLink, so whatever finds links finds this one.
 * Installed before Image, which would otherwise take the `![` for its own.
 */
function parseWikiEmbed(cx: InlineContext, next: number, pos: number): number {
	const link = next === BANG ? wikiLinkAt(cx, pos + 1) : null;
	return link ? cx.addElement(cx.elt("WikiEmbed", pos, link.to, [cx.elt("WikiLinkMark", pos, pos + 1), link])) : -1;
}

const idChar = (ch: number) => ch === DASH || (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);

/**
 * `^an-id` closing a line: the name a link gives the block. Letters, digits
 * and dashes after a space, as Obsidian has them; anywhere else a `^` is text.
 */
function parseBlockId(cx: InlineContext, next: number, pos: number): number {
	if (next !== CARET || pos === cx.offset) return -1;
	const before = cx.char(pos - 1);
	if (before !== SPACE && before !== TAB && before !== NL) return -1;
	let end = pos + 1;
	while (idChar(cx.char(end))) end++;
	if (end === pos + 1) return -1;
	let after = end;
	while (cx.char(after) === SPACE || cx.char(after) === TAB) after++;
	if (cx.char(after) !== NL && cx.char(after) !== -1) return -1;
	return cx.addElement(cx.elt("WikiBlockId", pos, end));
}

export const wikiLink: MarkdownConfig = {
	defineNodes: [
		{ name: "WikiLink", style: wikiLinkTag },
		{ name: "WikiEmbed" },
		{ name: "WikiLinkMark", style: tags.processingInstruction },
		{ name: "WikiLinkTarget" },
		{ name: "WikiLinkHeading" },
		{ name: "WikiLinkBlock" },
		{ name: "WikiLinkAlias" },
		{ name: "WikiBlockId", style: tags.processingInstruction },
	],
	parseInline: [
		{ name: "WikiEmbed", parse: parseWikiEmbed, before: "Image" },
		{ name: "WikiLink", parse: parseWikiLink, before: "Link" },
		{ name: "WikiBlockId", parse: parseBlockId },
	],
	props: [styleTags({ WikiLink: wikiLinkTag, WikiLinkMark: tags.processingInstruction, WikiBlockId: tags.processingInstruction })],
};
