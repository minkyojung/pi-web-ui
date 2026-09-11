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
 * A link to a heading or a block opens its note there. In the note already
 * open that is only a cursor moved; in another, the place goes with the path
 * and is landed on once that note's text has arrived (see Editor.tsx).
 *
 * Which notes exist comes from the sidebar's list, read when the marks are
 * built; the editor pokes this when the list changes.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { type Link, type Place, readWikiLink, resolve } from "../../../links.ts";
import { send } from "../ws";

/** The list of notes changed: build the marks again, since a missing note may now exist. */
export const notesChanged = StateEffect.define<null>();

const link = Decoration.mark({ class: "cm-wikilink" });
const missing = Decoration.mark({ class: "cm-wikilink cm-wikilink-missing" });
/** The `!` of `![[a note]]`. The note is not shown in place — this is the source — so the mark is all that says it would be. */
const embed = Decoration.mark({ class: "cm-wikiembed" });

type Ctx = { notes: () => string[]; here: () => string; open: (path: string, place: Place) => void };

/** How long a jump may wait for the parser to reach the end of a long note. */
const PARSE_MS = 500;

/** The wikilink at `pos`, if the position is inside one — or on the `!` of an embed, which is part of it. */
function linkAt(view: EditorView, pos: number): Link | null {
	let node = syntaxTree(view.state).resolveInner(pos, 1);
	while (node && node.name !== "WikiLink" && node.name !== "WikiEmbed") node = node.parent!;
	if (node?.name === "WikiEmbed") node = node.getChild("WikiLink")!;
	if (!node) return null;
	return readWikiLink(node, (from, to) => view.state.doc.sliceString(from, to)).link;
}

/**
 * The cursor to the start of the heading or the block's line a link names,
 * that line to the top of the view. A place the note does not have leaves
 * the cursor where it is: the note is open all the same, as in Obsidian.
 */
export function landOn(view: EditorView, place: Place): void {
	if (place.heading === null && place.block === null) return;
	const { state } = view;
	const heading = place.heading?.toLowerCase();
	let at: number | null = null;
	(ensureSyntaxTree(state, state.doc.length, PARSE_MS) ?? syntaxTree(state)).iterate({
		enter: (node) => {
			if (at !== null) return false;
			if (node.name.startsWith("ATXHeading") || node.name.startsWith("SetextHeading")) {
				if (heading === undefined) return false;
				// The heading's words, without the #s or the underline that make it one.
				let text = "";
				let last = node.from;
				for (let c = node.node.firstChild; c; c = c.nextSibling) {
					if (c.name !== "HeaderMark") continue;
					text += state.doc.sliceString(last, c.from);
					last = c.to;
				}
				text += state.doc.sliceString(last, node.to);
				if (text.trim().toLowerCase() === heading) at = node.from;
				return false;
			}
			if (node.name === "WikiBlockId" && state.doc.sliceString(node.from + 1, node.to) === place.block) {
				at = state.doc.lineAt(node.from).from;
			}
		},
	});
	if (at === null) return;
	view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "start" }) });
}

function marks(view: EditorView, ctx: Ctx): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const notes = ctx.notes();
	const here = ctx.here();
	const slice = (from: number, to: number) => view.state.doc.sliceString(from, to);
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				// The `!`, then on into the link it holds, which is drawn as any other.
				if (node.name === "WikiEmbed") return void builder.add(node.from, node.from + 1, embed);
				if (node.name !== "WikiLink") return;
				const { target } = readWikiLink(node.node, slice).link;
				builder.add(node.from, node.to, resolve(target, notes, here) ? link : missing);
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
				if (found === ctx.here()) landOn(view, hit);
				else if (found) ctx.open(found, hit);
				// No name and no note to be it — this note is not on the list — is nothing to make.
				else if (hit.target) send({ type: "new_note", name: hit.target.replace(/\.md$/i, "") });
				return true;
			},
		}),
		EditorView.baseTheme({
			".cm-wikilink": { textDecoration: "underline", textDecorationColor: "var(--muted-foreground)", textUnderlineOffset: "3px", cursor: "text" },
			".cm-wikilink-missing": { textDecorationStyle: "dotted", color: "var(--muted-foreground)" },
			".cm-wikiembed": { fontWeight: "600", color: "var(--muted-foreground)" },
		}),
	];
}
