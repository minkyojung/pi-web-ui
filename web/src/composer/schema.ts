/**
 * What the message box is made of: lines of text, and files as chips in them.
 *
 * As little of Tiptap as a chat box needs — a document of paragraphs, text,
 * a placeholder, undo — and no StarterKit: bold, lists and code blocks are
 * not things a message is written in. Not Tiptap's Mention either: the `@`
 * and `/` lists are the box's own (Composer.tsx, from the text before the
 * caret), and a mention's Backspace turns a chip back into typing, where a
 * file should go as one.
 *
 * A chip is drawn as plain DOM, not a React node view: Tiptap asks for that
 * of anything simple, and its React view of a leaf node keeps the caret from
 * leaving it (ueberdosis/tiptap#8369). ProseMirror marks it not editable and
 * takes care of the caret beside it at the end of a line.
 *
 * Module constants, so the editor is not reconfigured on every render.
 */
import { mergeAttributes, Node } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { __iconNode as fileCode } from "lucide-react/dist/esm/icons/file-code.mjs";
import { __iconNode as fileText } from "lucide-react/dist/esm/icons/file-text.mjs";
import { __iconNode as fileType } from "lucide-react/dist/esm/icons/file-type.mjs";
import { __iconNode as file } from "lucide-react/dist/esm/icons/file.mjs";
import { __iconNode as image } from "lucide-react/dist/esm/icons/image.mjs";

import { CHIP, mentionOf } from "./text.ts";

const SVG = "http://www.w3.org/2000/svg";

/** A file's icon by its kind, as the chips over a sent message have them (Beside.tsx). */
function iconOf(path: string): [string, Record<string, string>][] {
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	if (/^(png|jpe?g|gif|webp|avif|bmp)$/.test(ext)) return image;
	if (ext === "pdf") return fileType;
	if (ext === "md") return fileText;
	return path.includes(".") ? fileCode : file;
}

/** A lucide icon as a DOM spec: its shapes, drawn in the text's colour. */
function iconSpec(shapes: [string, Record<string, string>][]): unknown[] {
	return [
		`${SVG} svg`,
		{ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "size-3.5 shrink-0 text-muted-foreground" },
		...shapes.map(([tag, { key: _key, ...attrs }]) => [`${SVG} ${tag}`, attrs]),
	];
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** A file in a line: one position, deleted whole, `@path` as text (mentionOf). */
export const FileChip = Node.create({
	name: CHIP,
	group: "inline",
	inline: true,
	atom: true,
	selectable: false,
	addAttributes: () => ({ path: { default: "" } }),
	parseHTML: () => [{ tag: "span[data-file-chip]", getAttrs: (el) => ({ path: (el as HTMLElement).getAttribute("data-path") ?? "" }) }],
	renderHTML: ({ node, HTMLAttributes }) => [
		"span",
		mergeAttributes(HTMLAttributes, {
			"data-file-chip": "",
			"data-path": node.attrs.path,
			title: node.attrs.path,
			class: "mx-0.5 inline-flex max-w-64 items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-px align-baseline text-[0.9em] leading-snug",
		}),
		iconSpec(iconOf(node.attrs.path)),
		["span", { class: "truncate" }, nameOf(node.attrs.path)],
	],
	renderText: ({ node }) => mentionOf(node.attrs.path),
});

/** Everything the box is made of, once. */
export const extensions = [Document, Paragraph, Text, FileChip, UndoRedo, Placeholder.configure({ placeholder: "Message the agent" })];

