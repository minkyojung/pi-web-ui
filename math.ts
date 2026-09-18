/**
 * `$x^2$` in a line and `$$ … $$` on lines of their own — math, as Obsidian
 * has it, which CommonMark does not. Taught to the parser as an inline node
 * with a mark at each end, and a block for the fenced kind, so what reads
 * the tree agrees on where the math is: the editor draws it with KaTeX off
 * the cursor and shows the source on it, and the marks are hidden like any
 * other. Shared by both ends like wikilink.ts.
 *
 * Inline: a `$` not followed by a space opens, a `$` not preceded by a space
 * closes, on one line, and `$$` is never inline. Block: a line that begins
 * with `$$`, to the next line that ends with `$$` — one line when the same
 * line does both, as `$$x$$` on its own.
 */
import { styleTags, Tag, tags } from "@lezer/highlight";
import type { BlockContext, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";

export const mathTag = Tag.define(tags.monospace);

const DOLLAR = "$".charCodeAt(0);
const space = (ch: number) => ch === 32 || ch === 9 || ch === 10 || ch === -1;

function parseInlineMath(cx: InlineContext, next: number, pos: number): number {
	if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR || space(cx.char(pos + 1))) return -1;
	// A `$` right after a word or a digit is money, not math: "$5 and $6".
	const before = cx.char(pos - 1);
	if (before >= 48 && before <= 57) return -1;
	for (let end = pos + 2; end < cx.end; end++) {
		const ch = cx.char(end);
		if (ch === 10) return -1;
		if (ch !== DOLLAR || space(cx.char(end - 1))) continue;
		// The closing `$` is not the first of a `$$`, and not followed by a digit.
		const after = cx.char(end + 1);
		if (after === DOLLAR || (after >= 48 && after <= 57)) continue;
		return cx.addElement(cx.elt("InlineMath", pos, end + 1, [cx.elt("MathMark", pos, pos + 1), cx.elt("MathMark", end, end + 1)]));
	}
	return -1;
}

function parseMathBlock(cx: BlockContext, line: Line): boolean {
	const text = line.text.slice(line.pos);
	if (!text.startsWith("$$")) return false;
	const start = cx.lineStart + line.pos;
	// One line, `$$ … $$`, closed where it opened.
	const rest = text.slice(2);
	if (rest.trimEnd().endsWith("$$") && rest.trimEnd().length >= 2) {
		cx.addElement(cx.elt("MathBlock", start, start + text.length));
		cx.nextLine();
		return true;
	}
	// Or to the next line that ends with `$$`; unclosed, it runs to the end.
	let end = start + text.length;
	while (cx.nextLine()) {
		end = cx.lineStart + line.text.length;
		if (line.text.trimEnd().endsWith("$$")) {
			cx.nextLine();
			break;
		}
	}
	cx.addElement(cx.elt("MathBlock", start, end));
	return true;
}

export const math: MarkdownConfig = {
	defineNodes: [
		{ name: "InlineMath", style: { "InlineMath/...": mathTag } },
		{ name: "MathMark", style: tags.processingInstruction },
		{ name: "MathBlock", block: true, style: mathTag },
	],
	parseInline: [{ name: "InlineMath", parse: parseInlineMath, before: "InlineCode" }],
	// A `$$` line ends the paragraph above it, as a fence does: Obsidian sets a
	// block written straight under a line of prose, with no blank line between.
	parseBlock: [{ name: "MathBlock", parse: parseMathBlock, before: "FencedCode", endLeaf: (_cx, line) => line.text.slice(line.pos).startsWith("$$") }],
	props: [styleTags({ "InlineMath/...": mathTag, MathMark: tags.processingInstruction, MathBlock: mathTag })],
};
