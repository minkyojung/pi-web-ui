/**
 * pi's words, marked until the person has looked at them.
 *
 * The first feature, and the shape every one after it takes: it reads the
 * note's history (the spans that come with the note), draws one decoration,
 * and binds two keys. Nothing here is stored — accepting is a line in the
 * note's history, written by the server, and the marks come back from that.
 *
 * Mod-Enter accepts the run of pi's words under the cursor: it stays pi's in
 * the record and stops being drawn. Mod-Backspace puts back what pi replaced,
 * when the run is still the whole of what pi wrote, and otherwise takes the
 * run out. Either way that is the person's edit, and saved as one.
 *
 * Marks are kept as a decoration set, which CodeMirror moves along with the
 * typing around them; they are replaced whole whenever the server sends the
 * note, which it does after every write.
 */
import { type Extension, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";

import type { Span } from "../types";
import { send } from "../ws";

/** The spans that came with the note. Sent by the editor when the doc is the server's text. */
export const setSpans = StateEffect.define<Span[]>();

const mark = (span: Span) => Decoration.mark({ class: "cm-pi", attributes: { "data-pi": "" }, span });

const marks = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(setSpans)) {
				deco = Decoration.set(
					effect.value.filter((s) => s.author === "pi" && !s.accepted).map((s) => mark(s).range(s.from, s.to)),
					true,
				);
			}
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

/** The mark under the cursor, if the cursor is in one. */
function under(view: EditorView): { from: number; to: number; span: Span } | null {
	const pos = view.state.selection.main.head;
	let found: { from: number; to: number; span: Span } | null = null;
	view.state.field(marks).between(pos, pos, (from, to, value) => {
		if (from <= pos && pos <= to) found = { from, to, span: value.spec.span as Span };
		return false;
	});
	return found;
}

const style = EditorView.baseTheme({
	".cm-pi": {
		backgroundColor: "color-mix(in oklab, var(--foreground) 8%, transparent)",
		borderBottom: "1px dotted var(--muted-foreground)",
	},
});

export function pending(path: string): Extension {
	return [
		marks,
		style,
		// Above the editor's own keys: it binds Mod-Enter to a blank line and
		// Mod-Backspace to deleting to the line's start, and would take both.
		Prec.high(keymap.of([
			{
				key: "Mod-Enter",
				run: (view) => {
					const hit = under(view);
					if (!hit) return false;
					send({ type: "accept_note", path, from: hit.from, to: hit.to });
					return true;
				},
			},
			{
				key: "Mod-Backspace",
				run: (view) => {
					const hit = under(view);
					if (!hit) return false;
					view.dispatch({
						changes: { from: hit.from, to: hit.to, insert: hit.span.removed ?? "" },
						selection: { anchor: hit.from },
					});
					return true;
				},
			},
		])),
	];
}
