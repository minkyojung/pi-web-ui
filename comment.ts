/**
 * `%%a note to self%%`, Obsidian's comment, as the markdown parser sees it.
 *
 * Not CommonMark, so the parser is taught it the way wikilink.ts is: an
 * inline parser that takes the whole `%%…%%` at once, since what is inside
 * is not markdown — a `[[link]]` in a comment is not a link, and is not
 * indexed. One node with a mark at each end, styled as a comment. Shared by
 * both ends through syntax.ts.
 *
 * A `%%` on a line of its own opens the block form, which runs over blank
 * lines and blocks to the next such line — a block parser, the way
 * frontmatter.ts is one, that also ends a paragraph the line sits under, as
 * a fence does. Left open, it runs to the end of the note: a block parser
 * cannot give lines back once it has taken them.
 */
import { tags } from "@lezer/highlight";
import type { BlockContext, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";

const PCT = "%".charCodeAt(0);
const FENCE = "%%";

/** Whether this line is a `%%` alone, after whatever block markers lead it. */
const isFence = (line: Line) => line.text.slice(line.pos) === FENCE;

function parseBlockComment(cx: BlockContext, line: Line): boolean {
	if (!isFence(line)) return false;
	const from = cx.lineStart + line.pos;
	const marks = [cx.elt("CommentMark", from, from + 2)];
	while (cx.nextLine()) {
		if (isFence(line)) {
			marks.push(cx.elt("CommentMark", cx.lineStart + line.pos, cx.lineStart + line.pos + 2));
			cx.nextLine();
			break;
		}
	}
	cx.addElement(cx.elt("BlockComment", from, cx.prevLineEnd(), marks));
	return true;
}

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
		// Not "CommentBlock": that name is lezer's own, for an HTML comment, and
		// the editor hands the inside of one to the HTML parser.
		{ name: "BlockComment", block: true, style: tags.comment },
		{ name: "CommentMark", style: tags.processingInstruction },
	],
	parseInline: [{ name: "Comment", parse: parseComment, before: "Emphasis" }],
	parseBlock: [{ name: "BlockComment", parse: parseBlockComment, endLeaf: (_cx, line) => isFence(line), before: "HorizontalRule" }],
};
