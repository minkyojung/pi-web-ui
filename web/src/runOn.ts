/**
 * What a spec's tasks are to be run on — a model and an effort — as chosen
 * in the window, by spec.
 *
 * One choice for a spec, not one per task: the document's own distinction is
 * between the writing of a spec, which wants a strong model, and the running
 * of its tasks, which a cheaper one can do (spec-mode.md 3절 5). A task that
 * should run on something else is the bar changed and its Start pressed.
 *
 * Kept here and nowhere else — not in tasks.md, which is the plan the person
 * approved and whose fingerprint a model's name would change, and not in the
 * settings, since it is a choice about this work and not about the app. So it
 * lasts as long as the window does. Nothing chosen means the session's own
 * model, which is what the command does with no model named.
 */
import { createStore } from "./serverState.ts";

export interface RunOn {
	/** `provider/id`, as the picker keys a model. */
	model: string;
	level: string;
}

const store = createStore<ReadonlyMap<string, RunOn>>(new Map());

export const runOnStore = { get: store.get, subscribe: store.subscribe };

/** What `spec`'s tasks run on, or null for the session's model. */
export const runOnOf = (choices: ReadonlyMap<string, RunOn>, spec: string): RunOn | null => choices.get(spec) ?? null;

/** Choose for `spec`, or clear with null. */
export function chooseRunOn(spec: string, choice: RunOn | null): void {
	const next = new Map(store.get());
	if (choice) next.set(spec, choice);
	else next.delete(spec);
	store.set(next);
}

/**
 * The task the header offers to run: the cursor's line's, or the first a
 * selection covers — one task a run, each looked at and accepted before the
 * next (spec.ts). Read off the selection by the editor as it changes
 * (tasksBetween) and put here, since the header is not in the editor and the
 * editor does not draw it. Null when the selection covers no task.
 */
export interface Picked {
	spec: string;
	number: string;
}

const picked = createStore<Picked | null>(null);

export const pickedStore = { get: picked.get, subscribe: picked.subscribe };

/** What the selection offers now; null for nothing. Same spec and number as before is the same value, so nothing is woken for it. */
export function pickTask(next: Picked | null): void {
	const was = picked.get();
	if (was === next || (was && next && was.spec === next.spec && was.number === next.number)) return;
	picked.set(next);
}
