import { useEffect, useState } from "react";

import { PlayIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";

import { useWorkspaceList } from "./Repositories";
import { Button } from "./ui/button";

/** How the workspace's run stands, as the shell says it — electron/runs.js `stateOf`, under the run's id. */
export interface RunState {
	running: boolean;
	id: string;
	port: number | null;
	/** How the last run ended, when it ended on its own; null while running, after a stop, or before any. */
	exit: number | null;
}

/** The shell's side, absent in a browser tab — see preload.cjs `runs`. */
const shell = (
	window as {
		pi?: {
			runs?: {
				state(path: string): Promise<RunState | null>;
				start(path: string): Promise<{ state?: RunState | null; error?: string } | null>;
				stop(path: string): Promise<RunState | null>;
				onChange(listen: (path: string, state: RunState | null) => void): () => void;
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
 */
export function RunButton() {
	const list = useWorkspaceList();
	const path = list?.current ?? null;
	const [state, setState] = useState<RunState | null>(null);
	useEffect(() => {
		if (!shell || !path) return;
		let live = true;
		shell.state(path).then((next) => live && setState(next));
		const off = shell.onChange((at, next) => at === path && live && setState(next));
		return () => {
			live = false;
			off();
		};
	}, [path]);
	if (!shell || !path || !state) return null;
	const toggle = () => {
		if (state.running) void shell.stop(path);
		else shell.start(path).then((result) => result?.error && toast.error(result.error));
	};
	const died = !state.running && state.exit !== null && state.exit !== 0;
	return (
		<Button
			id="run"
			variant="ghost"
			size="sm"
			className="ml-auto cursor-default gap-1 px-1.5 text-xs font-normal"
			data-running={state.running || undefined}
			data-exit={state.exit ?? undefined}
			title={state.running ? `Stop ${state.id}` : died ? `${state.id} ended with exit ${state.exit} — see .pi/runs/${state.id}.log` : `Run ${state.id}`}
			onClick={toggle}
		>
			{state.running ? <SquareIcon className="size-3" /> : <PlayIcon className="size-3" />}
			<span>{state.id}</span>
			{state.running && <span className="font-mono text-muted-foreground">:{state.port}</span>}
			{died && <span className="text-destructive">exit {state.exit}</span>}
		</Button>
	);
}
