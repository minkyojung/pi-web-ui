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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * In the header of a spec's tasks.md, once its documents are approved: what
 * its tasks run on, and the run of what is selected.
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
 * And, while the cursor is on a task — or a selection covers some — the
 * button that runs it: `Run 2.2`, the number itself, so what will run is
 * read before it is pressed. One task, the first a selection covers: a task
 * is run, looked at and accepted before the next is (spec.ts), so there is
 * no running several at once.
 *
 * With the header's other controls (NoteHeader actions), drawn as they are:
 * no fill, the picker's own size. It was a line of its own over the list
 * once, a row of the window for a picker; which task is next, that line
 * said, is said by the list's own title now.
 */
export function RunActions({ path }: { path: string | null }) {
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
	const number = picked?.spec === name ? picked.number : null;
	const stop = runBlocked({
		online,
		streaming,
		compacting: config.isCompacting,
		hasCommand: commands.some((command) => command.name === RUN),
		spec,
		count: number === null ? 0 : 1,
		sent,
	});
	const reason = runWhy(stop);
	return (
		<>
			{number !== null && (
				<Button
					id="runPicked"
					variant="soft"
					size="sm"
					className="h-7 max-w-64 gap-1.5 px-2 text-xs text-status-progress"
					disabled={stop !== null}
					title={reason ?? undefined}
					onClick={() => {
						send(runMessage(name, [number], chosen ? { model: chosen.model, effort: chosen.level } : {}));
						setSent(true);
					}}
				>
					<PlayIcon className="size-3 shrink-0" />
					<span className="min-w-0 truncate">Run {number}</span>
				</Button>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="flex min-w-0 shrink">
						<ModelPicker
							id="runOn"
							model={chosen?.model ?? config.model}
							level={chosen?.level ?? null}
							models={config.models}
							disabled={!online}
							onChoose={(choice) => chooseRunOn(name, choice)}
						/>
					</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">Run tasks on{chosen ? "" : " · the session's model"}</TooltipContent>
			</Tooltip>
		</>
	);
}
