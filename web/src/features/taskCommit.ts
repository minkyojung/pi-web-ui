/**
 * What a task came to, at the end of its line in a spec's tasks.md: the
 * commit its run ended in, to press for what that changed (Commit.tsx).
 *
 * The second way to the same page. The list at the foot of the window
 * (TaskResults.tsx) is the record apart from the plan; this is for reading
 * the plan and wondering, at a line, what doing it amounted to. One short
 * thing and no more: the plan stays the plan.
 *
 * Drawn and not written. tasks.md is what the person approved, and its
 * fingerprint is over its words (specApproval.ts); a hash typed into it
 * would be a change to it. Which commit goes on which line comes in from
 * outside (`commits`) — the server reads it off the history (specResults.ts)
 * — and only a task that ended in one has any: a box checked by hand ended
 * in nothing, and nothing is made up for it.
 *
 * A done line is struck through (livePreview.ts), and a strike is one of
 * the few things a child cannot turn off: text-decoration is drawn by the
 * ancestor across its inline children, whatever they say. It is not drawn
 * across an inline-block, which is how the chip stands clear of it.
 */
import { type EditorState, type Extension, Facet, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { doneLines } from "../specRun.ts";

/** The commit each task's last run ended in, by the task's number: `{ commit, short }`. */
export type Commits = ReadonlyMap<string, { commit: string; short: string }>;

const NONE: Commits = new Map();

export const commits = Facet.define<Commits, Commits>({ combine: (values) => values[values.length - 1] ?? NONE });

/** The classes the chip wears, as the editor gives them — shadcn's Badge, which is React's and not imported here (taskStart.ts says why). */
export const chipChrome = Facet.define<string, string>({ combine: (values) => values[values.length - 1] ?? "" });

/** What pressing does, given the commit. */
export const onCommit = Facet.define<(commit: string) => void, ((commit: string) => void) | null>({ combine: (values) => values[values.length - 1] ?? null });

class Chip extends WidgetType {
	readonly task: string;
	readonly commit: string;
	readonly short: string;
	constructor(task: string, commit: string, short: string) {
		super();
		this.task = task;
		this.commit = commit;
		this.short = short;
	}
	eq(other: Chip) {
		return other.commit === this.commit && other.task === this.task;
	}
	toDOM(view: EditorView) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `${view.state.facet(chipChrome)} cm-task-commit`.trim();
		button.dataset.commit = this.commit;
		button.dataset.task = this.task;
		button.title = `What task ${this.task} changed`;
		button.setAttribute("aria-label", `Commit ${this.short}: what task ${this.task} changed`);
		button.textContent = this.short;
		// The press is the chip's: the caret stays where it is.
		button.onmousedown = (event) => event.preventDefault();
		button.onclick = (event) => {
			event.preventDefault();
			view.state.facet(onCommit)?.(this.commit);
		};
		return button;
	}
	ignoreEvent() {
		return true;
	}
}

function build(state: EditorState): DecorationSet {
	const known = state.facet(commits);
	const out = new RangeSetBuilder<Decoration>();
	if (known.size === 0) return out.finish();
	for (const { to, task } of doneLines(state.doc.toString())) {
		const found = known.get(task.number);
		if (found) out.add(to, to, Decoration.widget({ widget: new Chip(task.number, found.commit, found.short), side: 1 }));
	}
	return out.finish();
}

/** The chips, as decorations: rebuilt when the text or what is known of the commits changes. */
export const chips = StateField.define<DecorationSet>({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.startState.facet(commits) !== tr.state.facet(commits)) return build(tr.state);
		return deco;
	},
	provide: (field) => EditorView.decorations.from(field),
});

const look = EditorView.baseTheme({
	".cm-task-commit": {
		// inline-block: the line's strike is not drawn across one.
		display: "inline-block",
		marginLeft: "0.6em",
		verticalAlign: "baseline",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		cursor: "pointer",
	},
});

/** The feature: what draws the editor adds `commits.of(...)`, `chipChrome.of(...)` and `onCommit.of(...)` beside it. */
export const taskCommit: Extension = [chips, look];
