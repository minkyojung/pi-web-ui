/**
 * The HTML a note may hold, drawn — the little of it Obsidian users write:
 * `<u>`, `<sub>`, `<sup>`, `<kbd>`, `<mark>` and their like around words,
 * `<br>` for a line broken by hand, `<img>` with a width, and a `<details>`
 * block. Drawn from an allowlist and nothing else: a tag not on it, and every
 * attribute but the few named, is left as it was written or dropped. No
 * script runs, no style applies, nothing loads but a picture.
 *
 * Inline: an opening tag and its closing tag in the same paragraph become a
 * span with the tag's class, the tags themselves hidden off the cursor; a
 * `<br>` becomes a break; an `<img>` a picture (images.ts finds it). Block:
 * an HTML block off the cursor's lines becomes its sanitized DOM.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, type SelectionRange, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { imageSrc } from "./images.ts";

/** Tags that wrap words in a line. Their class is `cm-html-<tag>`. */
const INLINE = new Set(["u", "b", "strong", "i", "em", "s", "del", "mark", "sub", "sup", "kbd", "code", "small", "span", "ins"]);
/** Tags a block may hold, as DOM. */
const BLOCK = new Set([...INLINE, "br", "img", "a", "p", "div", "details", "summary", "center", "ul", "ol", "li", "blockquote", "pre", "hr", "table", "thead", "tbody", "tr", "th", "td", "h1", "h2", "h3", "h4", "h5", "h6", "figure", "figcaption"]);
/** The attributes kept, by tag; anything else goes. */
const ATTRS: Record<string, Set<string>> = {
	img: new Set(["src", "alt", "width", "height"]),
	a: new Set(["href"]),
	details: new Set(["open"]),
	td: new Set(["align", "colspan"]),
	th: new Set(["align", "colspan"]),
};
const SAFE_URL = /^(https?:|mailto:)/i;
const REMOTE = /^(https?:|data:)/i;

/**
 * The DOM an HTML string is allowed to be. Parsed by the browser into a
 * document of its own — nothing in it runs — then copied over element by
 * element: tags on the list with the attributes kept for them, the text of
 * everything else, a picture's address sent through the server's /vault
 * when it is in the folder.
 */
export function sanitize(html: string, here: string): DocumentFragment {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const out = document.createDocumentFragment();
	const copy = (from: Node, into: Node) => {
		for (const child of from.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) {
				into.appendChild(document.createTextNode(child.textContent ?? ""));
				continue;
			}
			if (child.nodeType !== Node.ELEMENT_NODE) continue;
			const el = child as Element;
			const tag = el.tagName.toLowerCase();
			if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object" || tag === "embed") continue;
			if (!BLOCK.has(tag)) {
				copy(el, into);
				continue;
			}
			const made = document.createElement(tag);
			for (const name of ATTRS[tag] ?? []) {
				const value = el.getAttribute(name);
				if (value === null) continue;
				if (name === "src") made.setAttribute("src", REMOTE.test(value) ? value : imageSrc(value, here));
				else if (name === "href") {
					if (SAFE_URL.test(value)) made.setAttribute("href", value);
				} else made.setAttribute(name, value);
			}
			if (tag === "a") {
				made.setAttribute("target", "_blank");
				made.setAttribute("rel", "noreferrer");
			}
			copy(el, made);
			into.appendChild(made);
		}
	};
	copy(doc.body, out);
	return out;
}

class Html extends WidgetType {
	html: string;
	here: string;
	constructor(html: string, here: string) {
		super();
		this.html = html;
		this.here = here;
	}
	eq(other: Html) {
		return this.html === other.html && this.here === other.here;
	}
	toDOM() {
		const el = document.createElement("div");
		el.className = "cm-html-block";
		el.appendChild(sanitize(this.html, this.here));
		return el;
	}
	ignoreEvent() {
		return false;
	}
}

class Break extends WidgetType {
	toDOM() {
		const br = document.createElement("br");
		br.className = "cm-html-br";
		return br;
	}
	eq() {
		return true;
	}
}

class Picture extends WidgetType {
	src: string;
	width: string | null;
	alt: string;
	constructor(src: string, width: string | null, alt: string) {
		super();
		this.src = src;
		this.width = width;
		this.alt = alt;
	}
	eq(other: Picture) {
		return this.src === other.src && this.width === other.width && this.alt === other.alt;
	}
	toDOM() {
		const img = document.createElement("img");
		img.className = "cm-image";
		img.src = this.src;
		img.alt = this.alt;
		img.draggable = false;
		if (this.width) img.setAttribute("width", this.width);
		return img;
	}
	ignoreEvent() {
		return false;
	}
}

const hide = Decoration.replace({});
const lineBreak = Decoration.replace({ widget: new Break() });
const touches = (ranges: readonly SelectionRange[], from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
const onLines = (state: EditorState, ranges: readonly SelectionRange[], from: number, to: number) =>
	touches(ranges, state.doc.lineAt(from).from, state.doc.lineAt(to).to);

/** A tag's name, and whether it closes. */
const tagOf = (text: string): { name: string; closing: boolean; attrs: string } | null => {
	const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(text);
	return m ? { name: m[2].toLowerCase(), closing: m[1] === "/", attrs: m[3] } : null;
};
const attr = (attrs: string, name: string): string | null => {
	const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
	return m ? (m[2] ?? m[3] ?? m[4]) : null;
};

/** The inline decorations: pairs of tags as spans, breaks, pictures, off the cursor. */
function inline(view: EditorView, here: () => string): DecorationSet {
	const { state } = view;
	const ranges = state.selection.ranges;
	const out: Range<Decoration>[] = [];
	const open: { name: string; node: SyntaxNode }[] = [];
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name !== "HTMLTag") return;
				const text = state.doc.sliceString(node.from, node.to);
				const tag = tagOf(text);
				if (!tag) return false;
				if (tag.name === "br") {
					if (!touches(ranges, node.from, node.to)) out.push(lineBreak.range(node.from, node.to));
					return false;
				}
				if (tag.name === "img") {
					const src = attr(tag.attrs, "src");
					if (src && !touches(ranges, node.from, node.to)) {
						out.push(Decoration.replace({ widget: new Picture(REMOTE.test(src) ? src : imageSrc(src, here()), attr(tag.attrs, "width"), attr(tag.attrs, "alt") ?? "") }).range(node.from, node.to));
					}
					return false;
				}
				if (!INLINE.has(tag.name)) return false;
				if (!tag.closing) {
					open.push({ name: tag.name, node: node.node });
					return false;
				}
				// The nearest open tag of this name, in this paragraph.
				const at = open.map((o) => o.name).lastIndexOf(tag.name);
				if (at === -1) return false;
				const opener = open.splice(at)[0].node;
				if (state.doc.lineAt(opener.from).number !== state.doc.lineAt(node.to).number && !sameParagraph(opener, node.node)) return false;
				if (touches(ranges, opener.from, node.to)) return false;
				out.push(hide.range(opener.from, opener.to));
				if (opener.to < node.from) out.push(Decoration.mark({ class: `cm-html cm-html-${tag.name}` }).range(opener.to, node.from));
				out.push(hide.range(node.from, node.to));
				return false;
			},
		});
		open.length = 0;
	}
	return Decoration.set(out, true);
}

const sameParagraph = (a: SyntaxNode, b: SyntaxNode) => a.parent !== null && a.parent === b.parent;

/** The blocks, from state: a decoration that replaces lines whole is one the editor takes from state only. */
function blocks(state: EditorState, here: () => string): DecorationSet {
	const out: Range<Decoration>[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name !== "HTMLBlock") return;
			if (onLines(state, state.selection.ranges, node.from, node.to)) return false;
			const first = state.doc.lineAt(node.from).from;
			const last = state.doc.lineAt(node.to).to;
			out.push(Decoration.replace({ widget: new Html(state.doc.sliceString(node.from, node.to), here()), block: true }).range(first, last));
			return false;
		},
	});
	return Decoration.set(out, true);
}

export function html(here: () => string): Extension {
	const field = StateField.define<DecorationSet>({
		create: (state) => blocks(state, here),
		update(value, tr) {
			if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return blocks(tr.state, here);
			return value;
		},
		provide: (f) => EditorView.decorations.from(f),
	});
	return [
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				constructor(view: EditorView) {
					this.decorations = inline(view, here);
				}
				update(u: ViewUpdate) {
					if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = inline(u.view, here);
				}
			},
			{ decorations: (p) => p.decorations },
		),
		field,
		EditorView.baseTheme({
			".cm-html-u, .cm-html-ins": { textDecoration: "underline" },
			".cm-html-b, .cm-html-strong": { fontWeight: "600" },
			".cm-html-i, .cm-html-em": { fontStyle: "italic" },
			".cm-html-s, .cm-html-del": { textDecoration: "line-through" },
			".cm-html-mark": { backgroundColor: "color-mix(in oklab, var(--primary) 25%, transparent)" },
			".cm-html-sub": { verticalAlign: "sub", fontSize: "0.8em" },
			".cm-html-sup": { verticalAlign: "super", fontSize: "0.8em" },
			".cm-html-kbd": { fontFamily: "ui-monospace, monospace", fontSize: "0.85em", border: "1px solid var(--border)", borderRadius: "3px", padding: "0 0.3em" },
			".cm-html-code": { fontFamily: "ui-monospace, monospace", fontSize: "0.9em" },
			".cm-html-small": { fontSize: "0.85em" },
			".cm-html-block": { display: "block" },
			".cm-html-block details": { padding: "0.25em 0" },
			".cm-html-block summary": { cursor: "pointer" },
			".cm-html-block img": { maxWidth: "100%", height: "auto", borderRadius: "6px" },
		}),
	];
}
