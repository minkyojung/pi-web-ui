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
 * its two marks, and what the properties say is properties.ts's business.
 *
 * The rule is Jekyll's, which everything since has kept: the first line of
 * the note is exactly `---`, and the block ends at the next line that is
 * exactly `---`. Not `...`, which YAML allows but Obsidian and the CommonMark
 * parsers do not; not a `---` with anything after it. A block never closed
 * is not a block: the note is a rule and prose, as it would be to Obsidian,
 * rather than front matter to the end of the file. A block parser cannot
 * give lines back once it has taken them, so that is settled by looking
 * ahead before taking the first.
 */
import type { Input } from "@lezer/common";
import { tags } from "@lezer/highlight";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

const FENCE = "---";

/** Whether this line is a fence: the three dashes and nothing else, a Windows `\r` allowed. */
const isFence = (text: string) => text === FENCE || text === FENCE + "\r";

/** Whether the note, opened with a fence on its first line, has a line that closes it. */
function closes(input: Input): boolean {
	// The whole note, once, only for a note whose first line is a fence: a
	// note is small, and this is the price of not swallowing it to the end.
	const text = input.read(0, input.length);
	return /\n---\r?(?:\n|$)/.test(text);
}

function parseFrontMatter(cx: BlockContext, line: Line): boolean {
	// Depth 1 is the document itself: any deeper is inside a quote or a list.
	if (cx.lineStart !== 0 || cx.depth > 1 || !isFence(line.text)) return false;
	// The context's input is the parser's own, not part of the declared
	// surface; it has held the note since the class was written, and the
	// test for an unclosed block would fail the day that changes.
	if (!closes((cx as unknown as { input: Input }).input)) return false;
	const marks = [cx.elt("FrontMatterMark", 0, FENCE.length)];
	while (cx.nextLine()) {
		if (isFence(line.text)) {
			marks.push(cx.elt("FrontMatterMark", cx.lineStart, cx.lineStart + FENCE.length));
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
