import { useEffect, useState, useSyncExternalStore } from "react";
import { PlayIcon } from "lucide-react";

import { APPROVED_DOCS, isSpec, specNameOf } from "../../../documentKinds.ts";
import { chooseRunOn, pickedStore, runOnOf, runOnStore } from "../runOn";
import { commandsStore, configStore, specsStore } from "../serverState";
import { RUN, runBlocked, runMessage, runWhy } from "../specRun.ts";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { ModelPicker } from "./ModelPicker";
import { Button } from "./ui/button";

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
 * And, while a selection in the list covers tasks, the button that runs
 * them as one: `Run 2.1, 2.2, 3`, the numbers themselves rather than a
 * count, so what will run is read before it is pressed — a drag is a tool
 * for words and takes a line it did not mean as often as not, and the
 * Starts on the lines it took are lit for the same reason. The one command
 * with the numbers on it; they run one after another, each as the one
 * before it is committed (spec.ts).
 *
 * Outside the page rather than in it, so
 * it does not scroll away from a long list.
 */
export function TaskBar({ path }: { path: string | null }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const choices = useSyncExternalStore(runOnStore.subscribe, runOnStore.get);
	const commands = useSyncExternalStore(commandsStore.subscribe, commandsStore.get);
	const picked = useSyncExternalStore(pickedStore.subscribe, pickedStore.get);
	// "Starting…" from the press until the agent is seen to be working, or a
	// moment passes with no sign of it: a refusal is a notice, not a state.
	const [sent, setSent] = useState(false);
	const streaming = config?.isStreaming ?? false;
	useEffect(() => {
		if (streaming) setSent(false);
	}, [streaming]);
	useEffect(() => {
		if (!sent) return;
		const timer = setTimeout(() => setSent(false), 5000);
		return () => clearTimeout(timer);
	}, [sent]);

	const name = path !== null && isSpec(path) && path.endsWith("/tasks.md") ? specNameOf(path) : null;
	const spec = name === null ? null : (specs?.find((entry) => entry.name === name) ?? null);
	if (!name || !spec || spec.approved < APPROVED_DOCS.length || !spec.written.includes("tasks.md") || !config) return null;

	const chosen = runOnOf(choices, name);
	const numbers = picked?.spec === name ? picked.numbers : [];
	const stop = runBlocked({
		online,
		streaming,
		compacting: config.isCompacting,
		hasCommand: commands.some((command) => command.name === RUN),
		spec,
		count: numbers.length,
		sent,
	});
	const reason = runWhy(stop);
	return (
		<div id="taskBar" className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted px-4 text-xs">
			<span className="min-w-0 flex-1 truncate text-muted-foreground">
				Run tasks on
				{!chosen && <span> · the session's model</span>}
				{/* Which task /spec-run would start, from the server's reading of the plan (Progress.next): the list marks no row as next. */}
				{spec.tasks?.next && <span id="next"> · next is {spec.tasks.next}</span>}
			</span>
			{numbers.length > 0 && (
				<Button
					id="runPicked"
					variant="outline"
					size="sm"
					className="h-7 max-w-64 gap-1.5 text-xs"
					disabled={stop !== null}
					title={reason ?? undefined}
					onClick={() => {
						send(runMessage(name, numbers, chosen ? { model: chosen.model, effort: chosen.level } : {}));
						setSent(true);
					}}
				>
					<PlayIcon className="size-3 shrink-0" />
					<span className="min-w-0 truncate">Run {numbers.join(", ")}</span>
				</Button>
			)}
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
