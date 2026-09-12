/**
 * The properties block at the top of a note — `---`, some lines, `---` — as
 * the markdown parser sees it.
 *
 * Front matter is not CommonMark: to the parser those lines are a rule and a
 * paragraph, so a `[[link]]` in a property would be indexed and the words
 * drawn as prose. This teaches it, the way lezer means it to be taught — a
 * block parser installed before the rule — and, like wikilink.ts, is shared
 * by both ends so the index and the editor agree on where the note's text
 * begins. Nothing inside is parsed as markdown: the block is one node with
 * its two marks, and what the properties say is not this file's business.
 *
 * Only at the very start of the note, as Obsidian has it, and closed by
 * `---` or `...`. A block never closed runs to the end of the note: a block
 * parser cannot give lines back once it has taken them, and the moment
 * between typing the first `---` and the second is short.
 */
import { tags } from "@lezer/highlight";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

const OPEN = "---";

function parseFrontMatter(cx: BlockContext, line: Line): boolean {
	// Depth 1 is the document itself: any deeper is inside a quote or a list.
	if (cx.lineStart !== 0 || cx.depth > 1 || line.text !== OPEN) return false;
	const marks = [cx.elt("FrontMatterMark", 0, OPEN.length)];
	while (cx.nextLine()) {
		if (line.text === OPEN || line.text === "...") {
			marks.push(cx.elt("FrontMatterMark", cx.lineStart, cx.lineStart + line.text.length));
			cx.nextLine();
			break;
		}
	}
	cx.addElement(cx.elt("FrontMatter", 0, cx.prevLineEnd(), marks));
	return true;
}

export const frontMatter: MarkdownConfig = {
	defineNodes: [
		{ name: "FrontMatter", block: true, style: tags.meta },
		{ name: "FrontMatterMark", style: tags.processingInstruction },
	],
	parseBlock: [{ name: "FrontMatter", parse: parseFrontMatter, before: "HorizontalRule" }],
};
