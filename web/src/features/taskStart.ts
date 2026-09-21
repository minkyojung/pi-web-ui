/**
 * A Start beside each task of a spec's tasks.md that is still to do.
 *
 * The task is the unit the agent runs — one session, one commit, one box —
 * and the line is where the person reads it, so the way to run it is on the
 * line. Pressing it types `/spec-run <spec> <number>` for them (specRun.ts);
 * nothing runs in the window, and nothing is kept here: which lines have one
 * is read off the text (startLines), whether it can be pressed comes in from
 * outside (`blocked`), and what pressing does is a callback (`onStart`). The
 * box beside it is checked by the run's end, and the Start goes with it.
 *
 * Where it stands: to the left of the line, outside the text, at a constant
 * distance from the content's edge — the place VS Code puts the ▶ that runs
 * a test, and a notebook the one that runs a cell. Not CodeMirror's gutter,
 * which sits at the scroller's edge while the content here is a centred
 * column (Editor.tsx): in a wide window that gutter is a hand's width from
 * the words. A widget at the line's start, taken out of the flow and put
 * left of it, follows the column and moves nothing.
 *
 * When it shows: on the line under the pointer, and on the line the cursor
 * is on, so that it is reached from the keyboard too. Always in the DOM,
 * only its opacity changes — a control that appears and disappears from
 * the layout would move the words. On every task with something left to
 * do: a heading's Start is all of its sub-tasks still to do, as Kiro's is,
 * and says so; a task done is one the command refuses, and has none.
 */
import { type EditorState, type Extension, Facet, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { startLines, tasksBetween, underOf } from "../specRun.ts";

/**
 * What stands in the way of starting, in words for the title, or null when
 * nothing does — runBlocked's answer (specRun.ts), given by whoever draws
 * the editor, since the stores it is read from are theirs.
 */
export const blocked = Facet.define<string | null, string | null>({ combine: (values) => values[values.length - 1] ?? null });

/**
 * The classes the button wears — shadcn's ghost icon button, as the editor
 * gives them (buttonVariants), so a Start looks like every other button in
 * the window. Given rather than imported: that module is React's, and this
 * one is the editor's and runs in node under test.
 */
export const chrome = Facet.define<string, string>({ combine: (values) => values[values.length - 1] ?? "" });

/** The task this session is running now (ConfigMsg.run), or null: its Start turns rather than offers. */
export const running = Facet.define<string | null, string | null>({ combine: (values) => values[values.length - 1] ?? null });

/** What pressing does, given the task's number. */
export const onStart = Facet.define<(number: string) => void, ((number: string) => void) | null>({ combine: (values) => values[values.length - 1] ?? null });

/** lucide's Play, drawn by hand: this is DOM, not React. */
function playIcon(): SVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "currentColor");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	const shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
	shape.setAttribute("points", "6 3 20 12 6 21 6 3");
	svg.append(shape);
	return svg;
}

/** lucide's Loader2, the app's spinner (ui/spinner.tsx), turning by the same class. */
function spinnerIcon(): SVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("class", "animate-spin");
	const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
	arc.setAttribute("d", "M21 12a9 9 0 1 1-6.219-8.56");
	svg.append(arc);
	return svg;
}

class Start extends WidgetType {
	readonly number: string;
	/**
	 * Whether the cursor is on this line, or a selection covers it — which is
	 * when it shows without the pointer, and how a selection that will be run
	 * as one says which tasks it took (Picked, runOn.ts).
	 */
	readonly here: boolean;
	readonly why: string | null;
	/** For a heading, the sub-tasks its Start runs, in order; empty for a task of its own. */
	readonly under: string[];
	/** Whether this is the task being run now — or the heading it is under. */
	readonly turning: boolean;
	constructor(number: string, here: boolean, why: string | null, under: string[], turning: boolean) {
		super();
		this.number = number;
		this.here = here;
		this.why = why;
		this.under = under;
		this.turning = turning;
	}
	eq(other: Start) {
		return other.number === this.number && other.here === this.here && other.why === this.why && other.under.join() === this.under.join() && other.turning === this.turning;
	}
	toDOM(view: EditorView) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `${view.state.facet(chrome)} cm-start`.trim();
		button.dataset.start = this.number;
		if (this.here) button.dataset.here = "";
		if (this.turning) button.dataset.running = "";
		button.disabled = this.why !== null;
		// A heading's Start says what it runs: all of it, and what that is.
		const what = this.under.length > 0 ? `Start ${this.number} — ${this.under.join(", ")}` : `Start ${this.number}`;
		// The one being run says so, over why the others cannot be pressed:
		// that it is running is the reason, said plainly.
		button.title = this.turning ? `Running ${this.number}` : (this.why ?? what);
		button.setAttribute("aria-label", this.turning ? `Running task ${this.number}` : what);
		button.append(this.turning ? spinnerIcon() : playIcon());
		// The press is the button's, not the editor's: the caret stays where it
		// is and the editor keeps the focus it has.
		button.onmousedown = (event) => event.preventDefault();
		button.onclick = (event) => {
			event.preventDefault();
			view.state.facet(onStart)?.(this.number);
		};
		return button;
	}
	ignoreEvent() {
		return true;
	}
}

/** The line a Start is on, so the line can be the thing hovered and the box the Start is put beside. */
const hasStart = Decoration.line({ class: "cm-hasStart" });

function build(state: EditorState): DecorationSet {
	const why = state.facet(blocked);
	const now = state.facet(running);
	const text = state.doc.toString();
	// The cursor's line, when the selection is a cursor: with words selected
	// the head is where the drag stopped, which may be the start of a line
	// the selection has not touched.
	const cursor = state.selection.main.empty ? state.doc.lineAt(state.selection.main.head).number : -1;
	// The tasks any non-empty selection covers, by the same rule the bar
	// offers them by, so what lights up is what would run.
	const covered = new Set(state.selection.ranges.filter((range) => !range.empty).flatMap((range) => tasksBetween(text, range.from, range.to).map((task) => task.number)));
	const out = new RangeSetBuilder<Decoration>();
	for (const { from, task } of startLines(text)) {
		const here = state.doc.lineAt(from).number === cursor || covered.has(task.number);
		out.add(from, from, hasStart);
		// The running task's own line, and the heading it is under, which is
		// running by way of it.
		const turning = now !== null && (now === task.number || now.startsWith(`${task.number}.`));
		out.add(from, from, Decoration.widget({ widget: new Start(task.number, here, why, underOf(text, task.number), turning), side: -1 }));
	}
	return out.finish();
}

/** The Starts, as decorations: rebuilt when the text, the cursor or what blocks them changes. */
export const starts = StateField.define<DecorationSet>({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.selection !== undefined || tr.startState.facet(blocked) !== tr.state.facet(blocked) || tr.startState.facet(running) !== tr.state.facet(running)) return build(tr.state);
		return deco;
	},
	provide: (field) => EditorView.decorations.from(field),
});

const look = EditorView.baseTheme({
	".cm-hasStart": { position: "relative" },
	".cm-start": {
		position: "absolute",
		left: "-2rem",
		// The line's text sits on its line-height; the 24px button is centred on it.
		top: "calc((1.6em - 1.5rem) / 2)",
		opacity: "0",
		transition: "opacity 120ms",
	},
	".cm-hasStart:hover .cm-start, .cm-start[data-here], .cm-start:focus-visible": { opacity: "1" },
	".cm-start:disabled": { opacity: "0.4", cursor: "default" },
	".cm-hasStart:not(:hover) .cm-start:disabled:not([data-here]):not([data-running])": { opacity: "0" },
	// The one running is always shown, and whole: it is the thing happening.
	".cm-start[data-running]": { opacity: "1" },
});

/** The feature: what draws the editor adds `chrome.of(...)`, `blocked.of(...)`, `running.of(...)` and `onStart.of(...)` beside it. */
export const taskStart: Extension = [starts, look];
