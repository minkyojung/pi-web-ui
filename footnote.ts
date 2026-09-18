/**
 * `[^note]` in the text and `[^note]: what it says` on a line of its own —
 * footnotes, as Obsidian and GitHub have them, which CommonMark and lezer's
 * GFM do not. Taught to the parser as inline nodes: a reference wherever
 * `[^id]` appears, a definition where `[^id]:` opens a paragraph. What
 * reads the tree then agrees on where they are — the editor numbers the
 * references in the order they appear and draws each as that number, and
 * the definition's label as the same number, with a way between them.
 * Shared by both ends like wikilink.ts, so their trees stay the same.
 */
import { styleTags, Tag, tags } from "@lezer/highlight";
import type { BlockContext, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";

export const footnoteTag = Tag.define();

const OPEN = "[".charCodeAt(0);
const CARET = "^".charCodeAt(0);
const CLOSE = "]".charCodeAt(0);
const COLON = ":".charCodeAt(0);

/** An id is what GitHub takes: letters, digits, `-` and `_`, at least one. */
const ID = /^[A-Za-z0-9_-]+$/;

function parseFootnote(cx: InlineContext, next: number, pos: number): number {
	if (next !== OPEN || cx.char(pos + 1) !== CARET) return -1;
	let end = pos + 2;
	while (end < cx.end && cx.char(end) !== CLOSE) end++;
	if (end >= cx.end || end === pos + 2) return -1;
	const id = cx.slice(pos + 2, end);
	if (!ID.test(id)) return -1;
	const marks = [cx.elt("FootnoteMark", pos, pos + 2), cx.elt("FootnoteId", pos + 2, end)];
	// A definition: `[^id]:` opening a line — the paragraph's first, or one
	// after it, since notes are written one under another without a blank
	// line between. Only there: GitHub reads one mid-line as a reference
	// followed by a colon.
	const atLineStart = pos === cx.offset || cx.slice(pos - 1, pos) === "\n";
	if (atLineStart && cx.char(end + 1) === COLON) {
		return cx.addElement(cx.elt("FootnoteDef", pos, end + 2, [...marks, cx.elt("FootnoteMark", end, end + 2)]));
	}
	return cx.addElement(cx.elt("FootnoteRef", pos, end + 1, [...marks, cx.elt("FootnoteMark", end, end + 1)]));
}

/**
 * A line that opens with `[^id]:` is a note, whatever follows. Claimed as a
 * block of its own before the parser can read `[^one]: word` as a link
 * reference definition, which is what CommonMark makes of a bracketed label,
 * a colon and one word. The line's words are parsed inline as usual, so the
 * definition's own mark (above) is read at the line's start.
 */
const DEF = /^\[\^[A-Za-z0-9_-]+\]:/;
function parseDefinition(cx: BlockContext, line: Line): boolean {
	const text = line.text.slice(line.pos);
	if (!DEF.test(text)) return false;
	const start = cx.lineStart + line.pos;
	cx.addElement(cx.elt("FootnoteDefinition", start, start + text.length, cx.parser.parseInline(text, start)));
	cx.nextLine();
	return true;
}

export const footnote: MarkdownConfig = {
	defineNodes: [
		{ name: "FootnoteDefinition", block: true },
		{ name: "FootnoteRef", style: { "FootnoteRef/...": footnoteTag } },
		{ name: "FootnoteDef", style: { "FootnoteDef/...": footnoteTag } },
		{ name: "FootnoteId", style: tags.labelName },
		{ name: "FootnoteMark", style: tags.processingInstruction },
	],
	parseInline: [{ name: "Footnote", parse: parseFootnote, before: "Link" }],
	parseBlock: [{ name: "FootnoteDefinition", parse: parseDefinition, before: "LinkReference" }],
	props: [styleTags({ "FootnoteRef/...": footnoteTag, "FootnoteDef/...": footnoteTag, FootnoteId: tags.labelName, FootnoteMark: tags.processingInstruction })],
};
