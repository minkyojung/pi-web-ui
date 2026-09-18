/**
 * `![[Other note]]` shown in place: the other note's text, or the section
 * under a heading (`#Heading`) or the block with an id (`#^id`), drawn as a
 * card off the cursor's line and as markup on it — as pictures are
 * (images.ts). The note's text comes from the server as it is on disk
 * (/api/note) and is drawn read-only (blocksDom.ts); the card's title opens
 * the note. A note that is not there says so. One level: an embed inside
 * an embedded note is a link.
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, type SelectionRange, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

import { readWikiLink, resolve } from "../../../links.ts";
import { blocksDom } from "./blocksDom.ts";
import { sectionOf } from "./embed.ts";
import { notesChanged } from "./links";

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

type Ctx = { notes: () => string[]; here: () => string; open: (path: string) => void };
type Target = { path: string | null; name: string; heading: string | null; block: string | null };

/**
 * The notes fetched so far, by path: what they said, or that they are on
 * their way, or that they could not be read. A card is drawn from this in
 * one go, and never changed once it is in the editor — the editor watches
 * its content for what the person types, and a card filling itself in
 * later reads as typing; instead the arrival is a poke (loaded) that has
 * the cards drawn again. Cleared when the list of notes changes.
 */
const fetched = new Map<string, { text: string } | "loading" | "failed">();
const loaded = StateEffect.define<string>();

function fetchNote(path: string, view: EditorView): void {
	if (fetched.has(path)) return;
	fetched.set(path, "loading");
	fetch(`/api/note?path=${encodeURIComponent(path)}`)
		.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
		.then((note: { text: string }) => fetched.set(path, { text: note.text }))
		.catch(() => fetched.set(path, "failed"))
		.finally(() => view.dispatch({ effects: loaded.of(path) }));
}

class Card extends WidgetType {
	target: Target;
	have: { text: string } | "loading" | "failed" | "missing";
	open: (path: string) => void;
	constructor(target: Target, have: { text: string } | "loading" | "failed" | "missing", open: (path: string) => void) {
		super();
		this.target = target;
		this.have = have;
		this.open = open;
	}
	eq(other: Card) {
		const a = this.target, b = other.target;
		const same = typeof this.have === "string" || typeof other.have === "string" ? this.have === other.have : this.have.text === other.have.text;
		return same && a.path === b.path && a.heading === b.heading && a.block === b.block && a.name === b.name;
	}
	toDOM() {
		const el = document.createElement("div");
		el.className = "cm-embed";
		const title = document.createElement("div");
		title.className = "cm-embed-title";
		const where = this.target.heading ? ` › ${this.target.heading}` : this.target.block ? ` › ^${this.target.block}` : "";
		title.textContent = (this.target.path ? this.target.path.replace(/\.md$/, "").split("/").pop() : this.target.name) + where;
		el.appendChild(title);
		const body = document.createElement("div");
		body.className = "cm-embed-body";
		el.appendChild(body);
		if (this.have === "missing" || !this.target.path) {
			body.textContent = `No note called ${this.target.name}.`;
			el.classList.add("cm-embed-missing");
			return el;
		}
		const path = this.target.path;
		title.addEventListener("mousedown", (e) => {
			e.preventDefault();
			this.open(path);
		});
		if (this.have === "loading") body.textContent = "…";
		else if (this.have === "failed") body.textContent = "Could not read it.";
		else {
			const section = sectionOf(this.have.text, this.target.heading, this.target.block);
			if (section === null) body.textContent = this.target.heading ? `No heading "${this.target.heading}" in it.` : `No block ^${this.target.block} in it.`;
			else body.appendChild(blocksDom(section));
		}
		return el;
	}
	ignoreEvent(event: Event) {
		// The title is the card's own; the rest is for the editor to place a cursor by.
		return (event.target as HTMLElement).closest?.(".cm-embed-title") !== null;
	}
}

const touches = (ranges: readonly SelectionRange[], from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
const onLines = (state: EditorState, ranges: readonly SelectionRange[], from: number, to: number) =>
	touches(ranges, state.doc.lineAt(from).from, state.doc.lineAt(to).to);

function cards(view: EditorView, ctx: Ctx): DecorationSet {
	const { state } = view;
	const slice = (from: number, to: number) => state.doc.sliceString(from, to);
	const out: Range<Decoration>[] = [];
	const notes = ctx.notes();
	const here = ctx.here();
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name !== "WikiEmbed") return;
				const link = node.node.getChild("WikiLink");
				if (!link) return false;
				const { target, heading, block } = readWikiLink(link, slice).link;
				if (IMAGE.test(target) || onLines(state, state.selection.ranges, node.from, node.to)) return false;
				const path = resolve(target, notes, here);
				if (path) fetchNote(path, view);
				const have = path ? (fetched.get(path) ?? "loading") : "missing";
				out.push(Decoration.replace({ widget: new Card({ path, name: target, heading, block }, have, ctx.open) }).range(node.from, node.to));
				return false;
			},
		});
	}
	return Decoration.set(out, true);
}

export function embeds(ctx: Ctx): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = cards(view, ctx);
			}
			update(u: ViewUpdate) {
				const poked = u.transactions.some((tr) => tr.effects.some((e) => e.is(notesChanged) || e.is(loaded)));
				if (u.transactions.some((tr) => tr.effects.some((e) => e.is(notesChanged)))) fetched.clear();
				if (u.docChanged || u.viewportChanged || u.selectionSet || poked || syntaxTree(u.startState) !== syntaxTree(u.state)) {
					this.decorations = cards(u.view, ctx);
				}
			}
		},
		{ decorations: (p) => p.decorations },
	);
}
