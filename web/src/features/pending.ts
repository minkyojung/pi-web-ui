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
 * run out. Either way that is the person's edit, and saved as one. The two
 * are commands here and keys in Editor.tsx, where every key of the editor
 * is bound in one order. Both are decisions, and look at the main cursor
 * alone, as the editor's own acceptCompletion does; an editing key
 * (listEdit.ts) works at every cursor or not at all.
 *
 * Marks are kept as a decoration set, which CodeMirror moves along with the
 * typing around them; they are replaced whole whenever the server sends the
 * note, which it does after every write.
 */
import { type ChangeSet, type Extension, StateEffect, StateField } from "@codemirror/state";
import { type Command, Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import type { Span } from "../types";
import { send } from "../ws";

/**
 * The spans that came with the note, over the server's text. When the doc has
 * typing the server has not seen, `through` is that typing, and the marks are
 * moved through it to where the words now sit.
 */
export const setSpans = StateEffect.define<{ spans: Span[]; through?: ChangeSet }>();

const mark = (span: Span) => Decoration.mark({ class: "cm-pi", attributes: { "data-pi": "" }, span });

const marks = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(setSpans)) {
				deco = Decoration.set(
					effect.value.spans.filter((s) => s.author === "pi" && !s.accepted).map((s) => mark(s).range(s.from, s.to)),
					true,
				);
				if (effect.value.through) deco = deco.map(effect.value.through);
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

/** Mod-Enter: accept the run of pi's words under the cursor; no if the cursor is not in one. */
export const acceptPending = (path: () => string): Command => (view) => {
	const hit = under(view);
	if (!hit) return false;
	send({ type: "accept_note", path: path(), from: hit.from, to: hit.to });
	return true;
};

/** Mod-Backspace: put back what pi replaced under the cursor, or take the run out; no if the cursor is not in one. */
export const restorePending: Command = (view) => {
	const hit = under(view);
	if (!hit) return false;
	view.dispatch({
		changes: { from: hit.from, to: hit.to, insert: hit.span.removed ?? "" },
		selection: { anchor: hit.from },
		userEvent: "delete",
	});
	return true;
};

/** The marks and their look. The keys are bound with the editor's others (Editor.tsx), in one order. */
export const pending: Extension = [marks, style];
