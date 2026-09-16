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
 * The marks move with the words, whoever changes them. The answer is about
 * the note as it was last written down, and typing does not change who wrote
 * what was there: the words being typed are the person's own by definition,
 * and those carry no mark. So the marks are carried to where their words went
 * — what a decoration does on its own — and asked for again whenever the note
 * on screen is the note on disk once more (Editor.tsx), which is what a
 * language client does with the diagnostics a server sent it. The one place
 * this is a frame out is a word typed into the middle of a marked run, whose
 * mark widens to take it in until the next answer splits it.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import { createStore } from "../serverState";
import { send } from "../ws";
import type { AuthoredSpan } from "../types";

/** Whether the note in front is showing its authors. A view of this window, not of the note. */
export const showAuthorsStore = createStore<boolean>(false);

/**
 * Where on screen the run that was asked about is, so the card can be put
 * beside it. In window coordinates, since that is what a popover wants and
 * what the editor can give for a place in the text.
 */
export type At = { left: number; top: number; width: number; height: number };
export const askedAtStore = createStore<At | null>(null);

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

function shown(spans: AuthoredSpan[], length: number): DecorationSet {
	// The answer is about the note as it is on disk, and it is only asked for
	// when the note on screen is that note — so a run past the end of what is
	// on screen is a question asked at the wrong moment, not a run to draw.
	// Left out rather than drawn wrong, and said out loud, since it should not
	// happen and a log is where a should-not is worth reading.
	const fit = spans.filter((span) => span.from < span.to && span.to <= length);
	if (fit.length !== spans.length) console.warn(`[authors] ${spans.length - fit.length} run(s) past the end of the note on screen; the answer was about another text`);
	return Decoration.set(fit.map((span) => mark(span).range(span.from, span.to)), true);
}

const field = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(current, tr) {
		for (const effect of tr.effects) {
			if (effect.is(paintAuthors)) return shown(effect.value, tr.state.doc.length);
			if (effect.is(clearAuthors)) return Decoration.none;
		}
		return current.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

/**
 * A click on a marked run asks what it is.
 *
 * Only while the marks are showing: off, the note is a note and a click is a
 * caret. The place is taken from where the pointer was rather than from the
 * mark's element, since a run can be wrapped over two lines and the card
 * belongs beside the half that was clicked.
 */
const asking = (path: () => string) =>
	EditorView.domEventHandlers({
		mousedown(event, view) {
			if (!(event.target instanceof Element) || !event.target.closest(".cm-by-pi, .cm-by-outside")) return false;
			const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (pos === null) return false;
			const rect = event.target.getBoundingClientRect();
			askedAtStore.set({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
			send({ type: "why_wrote", path: path(), pos });
			return false;
		},
	});

const look = EditorView.theme({
	// A line under, not a wash over: the words are still the note's and have to
	// read as prose. Enough to see when looking for it, little enough to read past.
	".cm-by-pi": { borderBottom: "1px solid color-mix(in oklab, var(--foreground) 35%, transparent)", cursor: "pointer" },
	".cm-by-outside": { borderBottom: "1px dashed color-mix(in oklab, var(--foreground) 35%, transparent)", cursor: "pointer" },
});

/**
 * Putting words back is an edit, and only the editor can make one.
 *
 * Registered the way a save is (saves.ts): the card that offers it is drawn
 * outside the editor and has no view to dispatch on, and reaching into the
 * editor's DOM for one would be reaching for something that is only there for
 * the browser checks. One editor at a time; a second registration replaces the
 * first.
 */
let putter: ((from: number, to: number, text: string) => void) | null = null;

export function registerPutBack(fn: (from: number, to: number, text: string) => void): () => void {
	putter = fn;
	return () => {
		if (putter === fn) putter = null;
	};
}

/** Put the words at [from, to) back to what they were. An edit of the person's, saved and logged as one. */
export const putBack = (from: number, to: number, text: string): void => putter?.(from, to, text);

export const authors = (path: () => string): Extension => [field, look, asking(path)];
