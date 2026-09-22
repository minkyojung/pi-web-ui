import { useEffect, useState, useSyncExternalStore } from "react";

import { PlayIcon, SquareIcon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";

import { configStore } from "../serverState";
import { send } from "../ws";
import { usePageFolder } from "./Repositories";
import { Button } from "./ui/button";

/** How the workspace's run stands, as the shell says it — electron/runs.js `stateOf`, under the run's id. */
export interface RunState {
	running: boolean;
	id: string;
	port: number | null;
	/** How the last run ended, when it ended on its own; null while running, after a stop, or before any. */
	exit: number | null;
}

/** What the shell says of the repository's commands here — electron/main.js `runState`. */
interface Scripts {
	/** Whether the repository has `.octave/config.toml` at all. */
	configured: boolean;
	/** Its default run, or null where it names none. */
	run: RunState | null;
}

/** The shell's side, absent in a browser tab — see preload.cjs `runs`. */
const shell = (
	window as {
		pi?: {
			runs?: {
				state(path: string): Promise<Scripts | null>;
				start(path: string): Promise<{ state?: Scripts | null; error?: string } | null>;
				stop(path: string): Promise<Scripts | null>;
				onChange(listen: (path: string, state: Scripts | null) => void): () => void;
			};
		};
	}
).pi?.runs;

/**
 * The repository's own run command — a dev server, a watcher — started and
 * stopped from the foot of the window: ▶ and the run's name, then ■ and the
 * port it was given while it runs (`OCTAVE_PORT`, so a workspace's is its
 * own). Only in a workspace whose repository names one in
 * `.octave/config.toml`, and only its default; the quickest way to see the
 * work with one's own eyes, which is what Conductor's ▶ is for too. A run
 * that ended by itself says its exit code in red — the one thing here that
 * wants doing — until it is started again.
 *
 * A repository with no such file has `Set up` in the same place instead,
 * which asks the agent to draft one (/setup, spec.ts): the file is where
 * the checks come from too, and a workspace with none is one whose tasks
 * are checked by nothing but the agent's word.
 */
export function RunButton() {
	const path = usePageFolder();
	const [state, setState] = useState<Scripts | null>(null);
	// Asked again when the agent's turn ends and when the window comes back:
	// the file is written by the agent, or by hand in an editor, and neither
	// is heard here.
	const working = useSyncExternalStore(configStore.subscribe, configStore.get)?.isStreaming ?? false;
	useEffect(() => {
		if (!shell || !path) return;
		let live = true;
		const ask = () => shell.state(path).then((next) => live && setState(next));
		ask();
		window.addEventListener("focus", ask);
		const off = shell.onChange((at, next) => at === path && live && setState(next));
		return () => {
			live = false;
			window.removeEventListener("focus", ask);
			off();
		};
	}, [path, working]);
	if (!shell || !path || !state) return null;
	if (!state.configured) {
		return (
			<Button
				id="set-up"
				variant="ghost"
				size="sm"
				className="ml-auto cursor-default gap-1 px-1.5 text-xs font-normal"
				title="This repository has no .octave/config.toml — nothing is set up, run or checked for it. Ask the agent to draft one from what is there."
				onClick={() => send({ type: "prompt", text: "/setup", command: true, behavior: "followUp" })}
			>
				<WrenchIcon className="size-3" />
				<span>Set up</span>
			</Button>
		);
	}
	const run = state.run;
	if (!run) return null;
	const toggle = () => {
		if (run.running) void shell.stop(path);
		else shell.start(path).then((result) => result?.error && toast.error(result.error));
	};
	const died = !run.running && run.exit !== null && run.exit !== 0;
	return (
		<Button
			id="run"
			variant="ghost"
			size="sm"
			className="ml-auto cursor-default gap-1 px-1.5 text-xs font-normal"
			data-running={run.running || undefined}
			data-exit={run.exit ?? undefined}
			title={run.running ? `Stop ${run.id}` : died ? `${run.id} ended with exit ${run.exit} — see .pi/runs/${run.id}.log` : `Run ${run.id}`}
			onClick={toggle}
		>
			{run.running ? <SquareIcon className="size-3" /> : <PlayIcon className="size-3" />}
			<span>{run.id}</span>
			{run.running && <span className="font-mono text-muted-foreground">:{run.port}</span>}
			{died && <span className="text-destructive">exit {run.exit}</span>}
		</Button>
	);
}
