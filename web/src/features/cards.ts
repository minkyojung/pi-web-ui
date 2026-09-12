/**
 * The words a card was opened on, underlined in the note, and the key that
 * opens one.
 *
 * Marks only. The cards themselves are drawn beside the editor in React — see
 * Cards.tsx — because a card belongs in the margin and CodeMirror has no
 * margin. What lives here is where each card points: set from the server's
 * cards and moved by the typing around them, so the margin asks the editor
 * where a card is now rather than where it was when it was written down.
 *
 * A draft is a card that has not been asked yet. It is held here too, so that
 * it moves with the words like the rest, and goes when they do.
 */
import { type ChangeSet, type EditorState, type Extension, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";

import type { Card } from "../types";

/** A card being written: chosen words with no question sent for them yet. */
export type Draft = { id: string; from: number; to: number; quote: string };

/** The server's cards, over its text. `through` is typing it has not seen. */
export const setCards = StateEffect.define<{ cards: Card[]; through?: ChangeSet }>();

export const setDraft = StateEffect.define<Draft | null>();

const mark = (id: string) => Decoration.mark({ class: "cm-card", attributes: { "data-card": id }, id });
const draftMark = Decoration.mark({ class: "cm-card cm-card-draft" });

const marks = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const effect of tr.effects) {
			if (!effect.is(setCards)) continue;
			// A card whose words are gone has nothing to underline; the margin
			// still shows it, saying so.
			deco = Decoration.set(
				effect.value.cards.filter((c) => !c.resolved && !c.orphaned).map((c) => mark(c.id).range(c.from, c.to)),
				true,
			);
			if (effect.value.through) deco = deco.map(effect.value.through);
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

const drafted = StateField.define<Draft | null>({
	create: () => null,
	update(draft, tr) {
		for (const effect of tr.effects) if (effect.is(setDraft)) return effect.value;
		if (!draft || !tr.docChanged) return draft;
		const from = tr.changes.mapPos(draft.from, 1);
		const to = tr.changes.mapPos(draft.to, -1);
		// The words it was about were taken out while it was being written.
		return from >= to ? null : { ...draft, from, to };
	},
	provide: (f) =>
		EditorView.decorations.from(f, (draft) => (draft ? Decoration.set(draftMark.range(draft.from, draft.to)) : Decoration.none)),
});

/** Where each card's words now sit in the text on screen, by card. */
export function cardPlaces(state: EditorState): Map<string, { from: number; to: number }> {
	const places = new Map<string, { from: number; to: number }>();
	const deco = state.field(marks, false);
	deco?.between(0, state.doc.length, (from, to, value) => {
		const id = value.spec.id as string | undefined;
		if (id) places.set(id, { from, to });
	});
	return places;
}

/** The draft being written, where it now sits. */
export const draftIn = (state: EditorState): Draft | null => state.field(drafted, false) ?? null;

const style = EditorView.baseTheme({
	".cm-card": { borderBottom: "1px solid color-mix(in oklab, var(--foreground) 35%, transparent)" },
	".cm-card-draft": { backgroundColor: "color-mix(in oklab, var(--foreground) 10%, transparent)" },
});

/** Short and unique enough to name a card; the server takes letters, digits, - and _. */
const name = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

/**
 * The chosen words, trimmed of the space at their edges — a card points at
 * words, and a trailing space is not one. The line, when nothing is chosen,
 * which is what Zed's inline assistant does with an empty selection.
 */
function chosen(state: EditorState): { from: number; to: number } | null {
	const { from, to } = state.selection.main;
	const line = state.doc.lineAt(from);
	let a = from === to ? line.from : from;
	let b = from === to ? line.to : to;
	const text = state.doc.sliceString(a, b);
	a += text.length - text.trimStart().length;
	b -= text.length - text.trimEnd().length;
	return a < b ? { from: a, to: b } : null;
}

export function cards(open: (draft: Draft) => void): Extension {
	return [
		marks,
		drafted,
		style,
		// Above the editor's own keys, which leave Mod-k alone today but are not
		// this feature's to depend on.
		Prec.high(
			keymap.of([
				{
					key: "Mod-k",
					run: (view) => {
						const words = chosen(view.state);
						if (!words) return false;
						const draft = { id: name(), ...words, quote: view.state.doc.sliceString(words.from, words.to) };
						view.dispatch({ effects: setDraft.of(draft) });
						open(draft);
						return true;
					},
				},
			]),
		),
	];
}
