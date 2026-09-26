/**
 * The message box's document as the text it stands for, and back.
 *
 * The box is a ProseMirror document (schema.ts) so that a file can sit in a
 * line as one chip; everything else about the box — the `/` and `@` lists,
 * the draft kept between windows, what a cleared queue hands back, what is
 * sent — was written against plain text and a caret, and stays so. These are
 * the translation between the two: a chip is `@path` in the text, as it was
 * when the box was a textarea, so the server and what pi reads are unchanged.
 *
 * Pure: JSON in and out, no editor, no DOM.
 */
import type { JSONContent } from "@tiptap/core";

/** The name the file chip goes by in the schema. */
export const CHIP = "fileChip";

/**
 * A path as it is written after `@`: bare, or in quotes when it has a space
 * in it — `@"Screenshot 1.png"` — as Claude Code writes one, so a file named
 * the way screenshots are still reads back as one chip.
 */
export const mentionOf = (path: string): string => (/\s/.test(path) ? `@"${path}"` : `@${path}`);

/** A line of the document: text and chips, in order. */
type Inline = { type: "text"; text: string } | { type: typeof CHIP; attrs: { path: string } };

/** The text a document stands for: a line a paragraph, a chip its `@path`. */
export function docToText(doc: JSONContent): string {
	return (doc.content ?? [])
		.map((paragraph) =>
			(paragraph.content ?? [])
				.map((node) => (node.type === CHIP ? mentionOf(String(node.attrs?.path ?? "")) : (node.text ?? "")))
				.join(""),
		)
		.join("\n");
}

/**
 * The document a text stands for. `@path` or `@"path"` becomes a chip only
 * where `isFile` says it names one — a word that happens to start with `@`
 * is a word — and only where it starts the line or follows a space, as a
 * mention is typed. Every line is kept, empty ones too.
 */
export function textToDoc(text: string, isFile: (path: string) => boolean): JSONContent {
	return {
		type: "doc",
		content: text.split(/\r\n?|\n/).map((line) => {
			const content: Inline[] = [];
			let at = 0;
			for (const match of line.matchAll(/(^|\s)@(?:"([^"]+)"|(\S+))/g)) {
				const path = match[2] ?? match[3]!;
				if (!isFile(path)) continue;
				const start = match.index! + match[1]!.length;
				if (start > at) content.push({ type: "text", text: line.slice(at, start) });
				content.push({ type: CHIP, attrs: { path } });
				at = match.index! + match[0].length;
			}
			if (at < line.length) content.push({ type: "text", text: line.slice(at) });
			return content.length ? { type: "paragraph", content } : { type: "paragraph" };
		}),
	};
}

/**
 * What a chip reads as in a line's text before the caret: one character, as
 * it is one position in the document, so an offset in the text is an offset
 * in the line — and not a space, so `@` right after a chip does not begin a
 * mention.
 */
export const CHIP_CHAR = "￼";
