/**
 * The part of a note an embed shows: all of it, the section under a heading
 * (`![[note#Heading]]`), or the block that carries an id (`![[note#^id]]`).
 * Cut on the parser's tree rather than by regex, so a `#` inside a code
 * block is not a heading, and a section runs to the next heading of its own
 * level or a higher one — which is what Obsidian shows.
 */
import { parser } from "../../../syntax.ts";

/** The words of a heading node, without its marks. */
function headingText(text: string, node: { from: number; to: number; firstChild: unknown }): string {
	type N = { name: string; from: number; to: number; nextSibling: N | null };
	let out = "";
	let last = node.from;
	for (let c = (node as unknown as { firstChild: N | null }).firstChild; c; c = c.nextSibling) {
		if (c.name !== "HeaderMark") continue;
		out += text.slice(last, c.from);
		last = c.to;
	}
	return (out + text.slice(last, node.to)).trim();
}

export function sectionOf(text: string, heading: string | null, block: string | null): string | null {
	if (!heading && !block) return text;
	const tree = parser.parse(text);
	if (heading) {
		const want = heading.trim().toLowerCase();
		let from = -1, level = 0, to = text.length;
		tree.iterate({
			enter: (node) => {
				const m = /^(ATX|Setext)Heading(\d)$/.exec(node.name);
				if (!m) return from === -1 ? undefined : false;
				const l = Number(m[2]);
				if (from === -1) {
					if (headingText(text, node.node).toLowerCase() === want) {
						from = node.from;
						level = l;
					}
				} else if (l <= level && node.from > from && to === text.length) {
					to = node.from;
				}
				return false;
			},
		});
		return from === -1 ? null : text.slice(from, to).trimEnd();
	}
	// A block: the paragraph, item or line that ends with `^id`.
	const id = `^${block}`;
	let found: string | null = null;
	tree.iterate({
		enter: (node) => {
			if (found !== null) return false;
			if (node.name !== "WikiBlockId" && !(node.name === "Paragraph" && text.slice(node.from, node.to).trimEnd().endsWith(id))) return;
			if (node.name === "WikiBlockId" && text.slice(node.from, node.to) !== id) return false;
			// The block the id marks: the paragraph or list item around it.
			let n = node.node;
			while (n.parent && n.parent.name !== "Document" && n.parent.name !== "ListItem" && n.name !== "Paragraph") n = n.parent;
			found = text.slice(n.from, n.to).replace(/\s*\^[A-Za-z0-9-]+\s*$/, "");
			return false;
		},
	});
	return found;
}
