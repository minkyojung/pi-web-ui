/**
 * A note's markdown as DOM, read-only, for an embed of another note: the
 * blocks the parser finds — headings, paragraphs, lists and tasks, code,
 * quotes, rules, tables — with their words drawn by inlineDom. The same
 * parser the editor reads with, so what a note looks like embedded is what
 * it looks like open, less the editing. An embed inside is a link, not a
 * card: one level is enough.
 */
import type { SyntaxNode } from "@lezer/common";

import { parser } from "../../../syntax.ts";
import { inlineDom } from "./inlineDom.ts";
import { tableOf } from "./tables.ts";

export function blocksDom(text: string): DocumentFragment {
	const out = document.createDocumentFragment();
	const slice = (from: number, to: number) => text.slice(from, to);
	const tree = parser.parse(text);
	for (let n = tree.topNode.firstChild; n; n = n.nextSibling) append(n, out, text, slice);
	return out;
}

/** The paragraph's own text, with a trailing block id and a leading task marker taken off. */
const paragraphText = (node: SyntaxNode, text: string) => text.slice(node.from, node.to).replace(/\s*\^[A-Za-z0-9-]+\s*$/, "");

function append(node: SyntaxNode, into: Node, text: string, slice: (from: number, to: number) => string): void {
	const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
	if (heading) {
		const el = document.createElement(`h${heading[1]}`);
		let words = "";
		let last = node.from;
		for (let c = node.firstChild; c; c = c.nextSibling) {
			if (c.name !== "HeaderMark") continue;
			words += text.slice(last, c.from);
			last = c.to;
		}
		el.appendChild(inlineDom((words + text.slice(last, node.to)).trim()));
		into.appendChild(el);
		return;
	}
	switch (node.name) {
		case "Paragraph": {
			const el = document.createElement("p");
			el.appendChild(inlineDom(paragraphText(node, text).replace(/\n/g, " ")));
			into.appendChild(el);
			return;
		}
		case "BulletList":
		case "OrderedList": {
			const el = document.createElement(node.name === "BulletList" ? "ul" : "ol");
			for (let item = node.firstChild; item; item = item.nextSibling) {
				if (item.name !== "ListItem") continue;
				const li = document.createElement("li");
				for (let c = item.firstChild; c; c = c.nextSibling) {
					if (c.name === "ListMark") continue;
					if (c.name === "Task") {
						const box = document.createElement("input");
						box.type = "checkbox";
						box.disabled = true;
						box.checked = /\[[xX]\]/.test(text.slice(c.from, c.to));
						li.appendChild(box);
						li.appendChild(document.createTextNode(" "));
						// The task's words follow its marker inside the same node.
						const marker = c.getChild("TaskMarker");
						li.appendChild(inlineDom(text.slice(marker ? marker.to : c.from, c.to).trim()));
						continue;
					}
					if (c.name === "Paragraph") li.appendChild(inlineDom(paragraphText(c, text).replace(/\n/g, " ")));
					else append(c, li, text, slice);
				}
				el.appendChild(li);
			}
			into.appendChild(el);
			return;
		}
		case "FencedCode":
		case "CodeBlock": {
			const pre = document.createElement("pre");
			const code = document.createElement("code");
			const marks = node.getChildren("CodeMark");
			const body = node.getChild("CodeText");
			code.textContent = body ? text.slice(body.from, body.to) : marks.length ? "" : text.slice(node.from, node.to);
			pre.appendChild(code);
			into.appendChild(pre);
			return;
		}
		case "Blockquote": {
			const el = document.createElement("blockquote");
			for (let c = node.firstChild; c; c = c.nextSibling) if (c.name !== "QuoteMark") append(c, el, text, slice);
			into.appendChild(el);
			return;
		}
		case "HorizontalRule":
			into.appendChild(document.createElement("hr"));
			return;
		case "Table": {
			const table = tableOf(node, slice);
			const el = document.createElement("table");
			el.className = "cm-table";
			const hr = el.createTHead().insertRow();
			table.header.forEach((cell) => {
				const th = document.createElement("th");
				th.appendChild(inlineDom(cell));
				hr.appendChild(th);
			});
			const body = el.createTBody();
			for (const row of table.rows) {
				const tr = body.insertRow();
				table.header.forEach((_, i) => tr.insertCell().appendChild(inlineDom(row[i] ?? "")));
			}
			into.appendChild(el);
			return;
		}
		case "FrontMatter":
		case "FootnoteDefinition":
			return;
		default: {
			const el = document.createElement("p");
			el.textContent = text.slice(node.from, node.to);
			into.appendChild(el);
		}
	}
}
