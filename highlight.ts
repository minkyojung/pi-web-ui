/**
 * `==words==`, Obsidian's highlight, as the markdown parser sees it.
 *
 * Not CommonMark, so the parser is taught it the way lezer teaches its own
 * `~~strikethrough~~`: a pair of delimiters with the same flanking rules,
 * resolved into one node around the words with a mark at each end. What
 * reads the tree then agrees on where a highlight is — the highlighter, the
 * decorations that hide its marks, and a link inside it is still a link.
 * Shared by both ends like wikilink.ts, so their trees stay the same.
 */
import { styleTags, Tag, tags } from "@lezer/highlight";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

export const highlightTag = Tag.define();

const EQ = "=".charCodeAt(0);
// lezer's own, for the flanking rules: a delimiter next to punctuation opens or closes as `~~` does.
const punctuation = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1‐-‧]/;
const delim = { resolve: "Highlight", mark: "HighlightMark" };

function parseHighlight(cx: InlineContext, next: number, pos: number): number {
	if (next !== EQ || cx.char(pos + 1) !== EQ || cx.char(pos + 2) === EQ) return -1;
	const before = cx.slice(pos - 1, pos);
	const after = cx.slice(pos + 2, pos + 3);
	const sBefore = /\s|^$/.test(before);
	const sAfter = /\s|^$/.test(after);
	const pBefore = punctuation.test(before);
	const pAfter = punctuation.test(after);
	return cx.addDelimiter(delim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter));
}

export const highlight: MarkdownConfig = {
	defineNodes: [
		{ name: "Highlight", style: { "Highlight/...": highlightTag } },
		{ name: "HighlightMark", style: tags.processingInstruction },
	],
	parseInline: [{ name: "Highlight", parse: parseHighlight, after: "Emphasis" }],
	props: [styleTags({ "Highlight/...": highlightTag, HighlightMark: tags.processingInstruction })],
};
