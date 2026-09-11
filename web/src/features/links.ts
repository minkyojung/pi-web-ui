/**
 * `[[links]]` in the note: drawn, followed, and made.
 *
 * The parser already knows where the links are (wikilink.ts); this asks the
 * tree over the visible lines and marks each one — and marks the ones that
 * name a note that does not exist, since the parser cannot know that. ⌘+click
 * follows a link, or makes the note it names when there is none, which is
 * how a note waiting to be written gets written. A plain click places the
 * cursor, as in any source editor.
 *
 * Which notes exist comes from the sidebar's list, read when the marks are
 * built; the editor pokes this when the list changes.
 */
import { syntaxTree } from "@codemirror/language";
import { type Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { resolve } from "../../../links.ts";
import { send } from "../ws";

/** The list of notes changed: build the marks again, since a missing note may now exist. */
export const notesChanged = StateEffect.define<null>();

const link = Decoration.mark({ class: "cm-wikilink" });
const missing = Decoration.mark({ class: "cm-wikilink cm-wikilink-missing" });

type Ctx = { notes: () => string[]; here: () => string; open: (path: string) => void };

/** The target text of the wikilink at `pos`, if the position is inside one. */
function linkAt(view: EditorView, pos: number): { target: string } | null {
	let node = syntaxTree(view.state).resolveInner(pos, 1);
	while (node && node.name !== "WikiLink") node = node.parent!;
	if (!node) return null;
	const target = node.getChild("WikiLinkTarget");
	return target ? { target: view.state.doc.sliceString(target.from, target.to).trim() } : null;
}

function marks(view: EditorView, ctx: Ctx): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const notes = ctx.notes();
	const here = ctx.here();
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name !== "WikiLink") return;
				const target = node.node.getChild("WikiLinkTarget");
				const name = target ? view.state.doc.sliceString(target.from, target.to).trim() : "";
				builder.add(node.from, node.to, resolve(name, notes, here) ? link : missing);
				return false;
			},
		});
	}
	return builder.finish();
}

export function links(ctx: Ctx): Extension {
	return [
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				constructor(view: EditorView) {
					this.decorations = marks(view, ctx);
				}
				update(u: ViewUpdate) {
					const poked = u.transactions.some((tr) => tr.effects.some((e) => e.is(notesChanged)));
					if (u.docChanged || u.viewportChanged || poked || syntaxTree(u.startState) !== syntaxTree(u.state)) {
						this.decorations = marks(u.view, ctx);
					}
				}
			},
			{ decorations: (p) => p.decorations },
		),
		EditorView.domEventHandlers({
			mousedown(event, view) {
				if (!(event.metaKey || event.ctrlKey)) return false;
				const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
				if (pos === null) return false;
				const hit = linkAt(view, pos);
				if (!hit) return false;
				event.preventDefault();
				const found = resolve(hit.target, ctx.notes(), ctx.here());
				if (found) ctx.open(found);
				else send({ type: "new_note", name: hit.target.replace(/\.md$/i, "") });
				return true;
			},
		}),
		EditorView.baseTheme({
			".cm-wikilink": { textDecoration: "underline", textDecorationColor: "var(--muted-foreground)", textUnderlineOffset: "3px", cursor: "text" },
			".cm-wikilink-missing": { textDecorationStyle: "dotted", color: "var(--muted-foreground)" },
		}),
	];
}
