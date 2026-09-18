/**
 * A line of the note's markdown as DOM, for the places a widget draws words
 * it cannot leave to the editor — a table's cells. The same parser the
 * editor reads with, and the few inline marks a cell holds: bold, italic,
 * struck, highlighted, code, links. Anything else is its text.
 */
import type { SyntaxNode } from "@lezer/common";

import { parser } from "../../../syntax.ts";

const TAG: Record<string, string> = {
	StrongEmphasis: "strong",
	Emphasis: "em",
	Strikethrough: "s",
	Highlight: "mark",
	InlineCode: "code",
};
const MARK = /Mark$/;

const hasAlias = (target: SyntaxNode): boolean => {
	for (let n = target.nextSibling; n; n = n.nextSibling) if (n.name === "WikiLinkAlias") return true;
	return false;
};

export function inlineDom(text: string): DocumentFragment {
	const out = document.createDocumentFragment();
	const build = (node: SyntaxNode, into: Node) => {
		let at = node.from;
		for (let child = node.firstChild; child; child = child.nextSibling) {
			if (child.from > at) into.appendChild(document.createTextNode(text.slice(at, child.from)));
			at = child.to;
			// The marks, a link's address, and an aliased link's target: written, not drawn.
			if (MARK.test(child.name) || child.name === "URL" || (child.name === "WikiLinkTarget" && hasAlias(child))) continue;
			const tag = TAG[child.name];
			if (tag) {
				const el = document.createElement(tag);
				build(child, el);
				into.appendChild(el);
			} else if (child.name === "WikiLink" || child.name === "Link") {
				const el = document.createElement("span");
				el.className = child.name === "WikiLink" ? "cm-wikilink" : "cm-link";
				build(child, el);
				into.appendChild(el);
			} else {
				build(child, into);
			}
		}
		if (at < node.to) into.appendChild(document.createTextNode(text.slice(at, node.to)));
	};
	// The document holds one paragraph holding the line; an empty cell holds nothing.
	const doc = parser.parse(text).topNode;
	build(doc.firstChild ?? doc, out);
	return out;
}
