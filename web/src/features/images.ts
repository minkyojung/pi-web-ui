/**
 * Pictures where the note says there are pictures.
 *
 * `![[a.png]]`, `![[a.png|300]]` and `![a](images/a.png)` are drawn as the
 * image off the cursor, and as written on its line — the way every other
 * mark in the note behaves (livePreview.ts). A picture on the web is fetched
 * from the web; one in the folder is fetched from the server's /vault, which
 * finds it the way Obsidian would (pictures.ts), so a name alone is enough.
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range, SelectionRange } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

import { readWikiLink } from "../../../links.ts";
import { forFolder } from "../workspace.ts";

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const REMOTE = /^(https?:|data:)/i;

/** Where the browser fetches the picture from. */
export function imageSrc(target: string, here: string): string {
	if (REMOTE.test(target)) return target;
	return forFolder(`/vault/${target.split("/").map(encodeURIComponent).join("/")}?from=${encodeURIComponent(here)}`);
}

/** Obsidian's `|300` and `|300x200` after an embed's name are its size; anything else is what to say instead of the picture. */
export function sizeOf(alias: string | null): { width?: number; height?: number; alt?: string } {
	if (!alias) return {};
	const m = /^(\d+)(?:x(\d+))?$/.exec(alias.trim());
	if (!m) return { alt: alias };
	return m[2] ? { width: Number(m[1]), height: Number(m[2]) } : { width: Number(m[1]) };
}

type Picture = { src: string; width?: number; height?: number; alt?: string };

class Image extends WidgetType {
	picture: Picture;
	// Not a parameter property: node runs the tests with types stripped, which does not do those.
	constructor(picture: Picture) {
		super();
		this.picture = picture;
	}
	eq(other: Image) {
		const a = this.picture, b = other.picture;
		return a.src === b.src && a.width === b.width && a.height === b.height && a.alt === b.alt;
	}
	toDOM() {
		const img = document.createElement("img");
		img.className = "cm-image";
		img.src = this.picture.src;
		img.alt = this.picture.alt ?? "";
		img.loading = "lazy";
		img.draggable = false;
		if (this.picture.width) img.width = this.picture.width;
		if (this.picture.height) img.height = this.picture.height;
		return img;
	}
	ignoreEvent() {
		return false;
	}
}

const touches = (ranges: readonly SelectionRange[], from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
const onLines = (state: EditorState, ranges: readonly SelectionRange[], from: number, to: number) =>
	touches(ranges, state.doc.lineAt(from).from, state.doc.lineAt(to).to);

/** The pictures in view, as widgets in the place of their markup, off the cursor's lines. */
function pictures(view: EditorView, here: () => string): DecorationSet {
	const { state } = view;
	const ranges = state.selection.ranges;
	const slice = (from: number, to: number) => state.doc.sliceString(from, to);
	const out: Range<Decoration>[] = [];
	const put = (from: number, to: number, picture: Picture) => out.push(Decoration.replace({ widget: new Image(picture) }).range(from, to));
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name === "WikiEmbed") {
					const link = node.node.getChild("WikiLink");
					if (!link) return false;
					const { target, alias } = readWikiLink(link, slice).link;
					if (!IMAGE.test(target) || onLines(state, ranges, node.from, node.to)) return false;
					put(node.from, node.to, { src: imageSrc(target, here()), ...sizeOf(alias) });
					return false;
				}
				if (node.name === "Image") {
					const url = node.node.getChild("URL");
					if (!url || onLines(state, ranges, node.from, node.to)) return false;
					const target = slice(url.from, url.to).trim();
					if (!REMOTE.test(target) && !IMAGE.test(target)) return false;
					// The words between `![` and `](` are what to say instead.
					const marks = node.node.getChildren("LinkMark");
					const alt = marks.length >= 2 ? slice(marks[0].to, marks[1].from) : "";
					put(node.from, node.to, { src: imageSrc(target, here()), alt });
					return false;
				}
			},
		});
	}
	return Decoration.set(out, true);
}

export function images(here: () => string): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = pictures(view, here);
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
					this.decorations = pictures(u.view, here);
				}
			}
		},
		{ decorations: (p) => p.decorations },
	);
}
