/**
 * Who wrote which words, shown on the words — when asked.
 *
 * Every character of a note has an author written down beside it, and until
 * now the only place that showed was the diff of what pi has written and
 * nobody has decided about yet. Keep it, and the knowing goes off the screen:
 * a month later there is no way to ask which of this was yours.
 *
 * Asked rather than always on, and that is the whole of why it is bearable.
 * A note permanently marked up where anyone but its writer touched it is a
 * note nobody can read — this app had that once, and the diff replaced it. So
 * it is a question put from the note's own menu, answered for as long as it is
 * useful, and gone again.
 *
 * Only what somebody else wrote is marked. Most of a note is its writer's, and
 * a note coloured all over says nothing. pi's words carry a line under them,
 * and a write that came from outside the app — vim, a sync client, a checkout —
 * carries a dashed one, since those are two different things to find out.
 *
 * Typing takes the marks away rather than moving them along. What is on screen
 * is about the note as it was last written down, the words being typed are the
 * person's own by definition, and a mark that shuffles along under a cursor
 * would be claiming to know something it does not. Asking again is one click.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import { createStore } from "../serverState";
import type { AuthoredSpan } from "../types";

/** Whether the note in front is showing its authors. A view of this window, not of the note. */
export const showAuthorsStore = createStore<boolean>(false);

/** The answer arrived: mark these runs. */
export const paintAuthors = StateEffect.define<AuthoredSpan[]>();
/** Turned off, or the note changed under it. */
export const clearAuthors = StateEffect.define<null>();

const marks = new Map<string, Decoration>();
/** One decoration per (author, when), since a note has few writings and many words. */
function mark(span: AuthoredSpan): Decoration {
	const key = `${span.author}:${span.at}:${span.session ?? ""}`;
	let found = marks.get(key);
	if (!found) {
		const when = new Date(span.at).toLocaleString();
		found = Decoration.mark({
			class: span.author === "pi" ? "cm-by-pi" : "cm-by-outside",
			// The native tooltip: a card here would be a second thing to build
			// and a second thing to dismiss, for a line of text.
			attributes: { title: span.author === "pi" ? `pi · ${when}` : `outside this app · ${when}` },
		});
		marks.set(key, found);
	}
	return found;
}

const shown = (spans: AuthoredSpan[], length: number): DecorationSet =>
	Decoration.set(
		spans
			// The answer is about the note as it is on disk; anything past the end
			// of what is on screen is not this note's to mark.
			.filter((span) => span.from < span.to && span.to <= length)
			.map((span) => mark(span).range(span.from, span.to)),
		true,
	);

const field = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(current, tr) {
		for (const effect of tr.effects) {
			if (effect.is(paintAuthors)) return shown(effect.value, tr.state.doc.length);
			if (effect.is(clearAuthors)) return Decoration.none;
		}
		return tr.docChanged ? Decoration.none : current.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

const look = EditorView.theme({
	// A line under, not a wash over: the words are still the note's and have to
	// read as prose. Enough to see when looking for it, little enough to read past.
	".cm-by-pi": { borderBottom: "1px solid color-mix(in oklab, var(--foreground) 35%, transparent)" },
	".cm-by-outside": { borderBottom: "1px dashed color-mix(in oklab, var(--foreground) 35%, transparent)" },
});

export const authors: Extension = [field, look];
