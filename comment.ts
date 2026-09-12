/**
 * `%%a note to self%%`, Obsidian's comment, as the markdown parser sees it.
 *
 * Not CommonMark, so the parser is taught it the way wikilink.ts is: an
 * inline parser that takes the whole `%%…%%` at once, since what is inside
 * is not markdown — a `[[link]]` in a comment is not a link, and is not
 * indexed. One node with a mark at each end, styled as a comment. Shared by
 * both ends through syntax.ts.
 *
 * Within a paragraph only. Obsidian also lets a `%%` on a line of its own
 * open a comment that runs over blocks; that is a block parser for another
 * day, and until then such a `%%` is text.
 */
import { tags } from "@lezer/highlight";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

const PCT = "%".charCodeAt(0);

function parseComment(cx: InlineContext, next: number, pos: number): number {
	if (next !== PCT || cx.char(pos + 1) !== PCT) return -1;
	for (let end = pos + 2; end < cx.end - 1; end++) {
		if (cx.char(end) !== PCT || cx.char(end + 1) !== PCT) continue;
		if (end === pos + 2) return -1; // `%%%%` is nothing.
		return cx.addElement(cx.elt("Comment", pos, end + 2, [cx.elt("CommentMark", pos, pos + 2), cx.elt("CommentMark", end, end + 2)]));
	}
	return -1;
}

export const comment: MarkdownConfig = {
	defineNodes: [
		{ name: "Comment", style: tags.comment },
		{ name: "CommentMark", style: tags.processingInstruction },
	],
	parseInline: [{ name: "Comment", parse: parseComment, before: "Emphasis" }],
};
