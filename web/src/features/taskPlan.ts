/**
 * A spec's tasks.md, read: the plan drawn over the document.
 *
 * The editor already draws a task list well — the hanging indent, the
 * blank lines, the boxes — and reading changes none of that: the words stay
 * where they were, to the pixel, so ⌘E moves nothing. What reading adds is
 * what the document cannot say of itself, on the lines it is about:
 *
 * - The box becomes the task's standing (taskTree.ts standingOf): done,
 *   running, next, or still to do. The box is the editor's own widget
 *   (livePreview), so it is not drawn again — a class on the line says the
 *   standing, and the theme draws the box as that shape. Two replacements of
 *   one range would fight; a class fights nothing.
 * - A heading says how many of its sub-tasks are done, at the end of its line,
 *   where a task's commit sits (taskCommit.ts).
 * - The two lines read by name — _Requirements_, _Done when_ — step back, so
 *   the bullets, which are what a task involves, read first.
 *
 * All of it is a pure function of the state (`plan`), so it is pinned in node;
 * the field only calls it, again when the text or the running task changes.
 * On in reading only (Editor.tsx), so there is no cursor to answer to.
 */
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { nextTask } from "../../../specTasks.ts";
import { progressUnder, type Standing, standingOf, treeOf } from "../taskTree.ts";
import { running } from "./taskStart.ts";

const STANDING: Record<Standing, Decoration> = {
	done: Decoration.line({ class: "cm-plan-task cm-standing-done" }),
	running: Decoration.line({ class: "cm-plan-task cm-standing-running" }),
	next: Decoration.line({ class: "cm-plan-task cm-standing-next" }),
	todo: Decoration.line({ class: "cm-plan-task cm-standing-todo" }),
};
const key = Decoration.line({ class: "cm-plan-key" });

/** `1 / 2` at the end of a heading's line: its sub-tasks done, over how many there are. */
class Count extends WidgetType {
	readonly done: number;
	readonly total: number;
	constructor(done: number, total: number) {
		super();
		this.done = done;
		this.total = total;
	}
	eq(other: Count) {
		return other.done === this.done && other.total === this.total;
	}
	toDOM() {
		const el = document.createElement("span");
		el.className = "cm-plan-count";
		el.dataset.progress = "";
		el.textContent = `${this.done} / ${this.total}`;
		el.setAttribute("aria-label", `${this.done} of ${this.total} sub-tasks done`);
		return el;
	}
	ignoreEvent() {
		return true;
	}
}

/** What is drawn over the plan, from the text and the running task alone. */
export function plan(state: EditorState): DecorationSet {
	const tree = treeOf(state.doc.toString());
	const now = state.facet(running);
	const next = nextTask(tree.tasks)?.number ?? null;
	const out = new RangeSetBuilder<Decoration>();
	// In document order, which a builder wants: rows are in order, and a task's
	// key lines follow its line before the next row begins.
	for (const row of tree.rows) {
		if (row.kind !== "task") continue;
		const line = state.doc.line(row.line);
		out.add(line.from, line.from, STANDING[standingOf(row, { running: now, next })]);
		if (row.children.length > 0) {
			const { done, total } = progressUnder(tree.tasks, row.number);
			out.add(line.to, line.to, Decoration.widget({ widget: new Count(done, total), side: 1 }));
		}
		for (const at of [row.requirementsLine, row.doneWhenLine].filter((n): n is number => n !== null).sort((a, b) => a - b)) {
			const from = state.doc.line(at).from;
			out.add(from, from, key);
		}
	}
	return out.finish();
}

const field = StateField.define<DecorationSet>({
	create: plan,
	update(deco, tr) {
		if (tr.docChanged || tr.startState.facet(running) !== tr.state.facet(running)) return plan(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

/** lucide's shapes, as masks: the box is the editor's, only its face is drawn here. */
const icon = (body: string) =>
	`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`)}")`;
const CHECK = icon("<path d='M20 6 9 17l-5-5'/>");
const CIRCLE = icon("<circle cx='12' cy='12' r='10'/>");
const CIRCLE_DOT = icon("<circle cx='12' cy='12' r='10'/><circle cx='12' cy='12' r='2' fill='black'/>");
const LOADER = icon("<path d='M21 12a9 9 0 1 1-6.219-8.56'/>");

const look = EditorView.baseTheme({
	// The box, as the standing: the same element the editor draws, its face
	// a mask in the text's colour. Its size is the box's, so nothing moves.
	".cm-plan-task .cm-task": {
		appearance: "none",
		WebkitAppearance: "none",
		width: "1em",
		height: "1em",
		border: "none",
		borderRadius: "0",
		backgroundColor: "currentColor",
		color: "var(--muted-foreground)",
		maskRepeat: "no-repeat",
		maskPosition: "center",
		maskSize: "contain",
		WebkitMaskRepeat: "no-repeat",
		WebkitMaskPosition: "center",
		WebkitMaskSize: "contain",
		cursor: "default",
	},
	".cm-standing-done .cm-task": { maskImage: CHECK, WebkitMaskImage: CHECK },
	".cm-standing-todo .cm-task": { maskImage: CIRCLE, WebkitMaskImage: CIRCLE },
	".cm-standing-next .cm-task": { maskImage: CIRCLE_DOT, WebkitMaskImage: CIRCLE_DOT, color: "var(--foreground)" },
	".cm-standing-running .cm-task": { maskImage: LOADER, WebkitMaskImage: LOADER, color: "var(--foreground)", animation: "cm-plan-spin 1s linear infinite" },
	"@keyframes cm-plan-spin": { to: { transform: "rotate(360deg)" } },
	// Done is said by the mark now; a strike through the words made them the
	// hardest lines to read, on the page whose point is reading them.
	// Three classes to livePreview's two (`.cm-line.cm-task-done`): the same
	// weight would leave it to whichever rule was written later.
	".cm-line.cm-plan-task.cm-task-done": { textDecoration: "none" },
	// The two keys step back so the bullets read first.
	".cm-line.cm-plan-key": { fontStyle: "italic", color: "var(--muted-foreground)" },
	".cm-plan-count": {
		display: "inline-block",
		// A list line hangs its indent with a negative text-indent, which an
		// inline-block inherits into its own first line: without this the count
		// is drawn two ems to the left, over the words.
		textIndent: "0",
		marginLeft: "0.6em",
		fontSize: "0.8em",
		color: "var(--muted-foreground)",
		fontVariantNumeric: "tabular-nums",
		verticalAlign: "baseline",
	},
});

/** The feature, for a spec's tasks.md while it is read; `running.of(...)` (taskStart.ts) says which task the session is on. */
export const taskPlan: Extension = [field, look];
