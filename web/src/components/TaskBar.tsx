import { useSyncExternalStore } from "react";

import { SPEC_DOCS, isSpec, specNameOf } from "../../../documentKinds.ts";
import { chooseRunOn, runOnOf, runOnStore } from "../runOn";
import { configStore, specsStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { ModelPicker } from "./ModelPicker";

/**
 * Over a spec's tasks.md, once all three documents are approved: what its
 * tasks run on.
 *
 * The one setting the running of tasks has, and the line where the tasks are
 * run from (taskStart.ts) is the line to make it on. A choice and nothing
 * more — pressing nothing here runs anything; the Start beside a task does,
 * and takes what is chosen here with it. One choice for the spec, kept for
 * as long as the window is (runOn.ts).
 *
 * The same picker as the message box's, in the mode where it reports rather
 * than sets: the session's model is not touched, and the two can differ,
 * which is the point — the spec written by a strong model, its tasks run by
 * a cheaper one. With nothing chosen it shows the session's model, which is
 * what a run gets when none is named.
 *
 * Outside the page rather than in it, like the approval's line (SpecBar), so
 * it does not scroll away from a long list.
 */
export function TaskBar({ path }: { path: string | null }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const choices = useSyncExternalStore(runOnStore.subscribe, runOnStore.get);

	const name = path !== null && isSpec(path) && path.endsWith("/tasks.md") ? specNameOf(path) : null;
	const spec = name === null ? null : (specs?.find((entry) => entry.name === name) ?? null);
	if (!name || !spec || spec.approved < SPEC_DOCS.length || !config) return null;

	const chosen = runOnOf(choices, name);
	return (
		<div id="taskBar" className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted px-4 text-xs">
			<span className="min-w-0 flex-1 truncate text-muted-foreground">
				Run tasks on
				{!chosen && <span> · the session's model</span>}
			</span>
			<ModelPicker
				id="runOn"
				model={chosen?.model ?? config.model}
				level={chosen?.level ?? null}
				models={config.models}
				disabled={!online}
				onChoose={(choice) => chooseRunOn(name, choice)}
			/>
		</div>
	);
}
