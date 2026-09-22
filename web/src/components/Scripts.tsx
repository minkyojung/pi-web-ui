import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ExternalLinkIcon, FileTextIcon, PlayIcon, RotateCwIcon, SquareIcon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";

import { configStore } from "../serverState";
import { send } from "../ws";
import { usePageFolder } from "./Repositories";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";

/** How the workspace's run stands, as the shell says it — electron/runs.js `stateOf`, under the run's id. */
export interface RunState {
	running: boolean;
	id: string;
	port: number | null;
	/** How the last run ended, when it ended on its own; null while running, after a stop, or before any. */
	exit: number | null;
}

/** A log a command left in `.pi/runs/` — electron/runLogs.js. */
export interface RunLog {
	name: string;
	path: string;
	/** As its last line says; null while it is still being written. */
	exit: number | null;
	modified: number;
}

/** What the shell says of the repository's commands here — electron/main.js `runState`. */
interface Scripts {
	/** Whether the repository has `.octave/config.toml` at all. */
	configured: boolean;
	/** The ids of its runs, in the file's order; the first with `default` is what the face shows before any has run. */
	runs: string[];
	/** The run going, or the last that ended, or the default not yet run; null where the file names none. */
	run: RunState | null;
	logs: RunLog[];
}

/** The shell's side, absent in a browser tab — see preload.cjs `runs` and `workspaces.setup`. */
const shell = (
	window as {
		pi?: {
			runs?: {
				state(path: string): Promise<Scripts | null>;
				start(path: string, id?: string): Promise<{ state?: Scripts | null; error?: string } | null>;
				stop(path: string): Promise<Scripts | null>;
				onChange(listen: (path: string, state: Scripts | null) => void): () => void;
			};
			workspaces?: { setup(path: string): Promise<{ error?: string; ran?: boolean } | null> };
		};
	}
).pi;

/** The repository's setup run in a workspace, with what it said as a toast — the row has no room for it. */
function runSetup(path: string): void {
	toast.promise(
		shell!.workspaces!.setup(path).then((result) => {
			if (result?.error) throw new Error(result.error);
			return result?.ran ? "Setup finished." : "This repository names no setup command in .octave/config.toml.";
		}),
		{ loading: "Setting up…", success: (said: string) => said, error: (err: Error) => err.message },
	);
}

/**
 * The repository's own commands, at the foot of the window: one button whose
 * face says how the run stands — ▶ and the run's name; ■ and the port it was
 * given while it runs (`OCTAVE_PORT`, so a workspace's is its own); a red
 * dot when it ended by itself — and whose menu holds what can be done about
 * them: start any of the runs the file names, or stop the one going (one at
 * a time in a workspace), open what it serves, read what any command
 * printed (a tab on its log, Code.tsx), run the setup again. Only in a
 * workspace whose repository has `.octave/config.toml`; one that has none
 * says `Set up` here instead, which asks the agent to draft it (/setup,
 * spec.ts). The commands themselves run in the shell (electron/runs.js,
 * scripts.js); the logs are files, and a tab is where a file is read.
 */
export function Scripts({ onOpen }: { onOpen: (path: string) => void }) {
	const path = usePageFolder();
	const [state, setState] = useState<Scripts | null>(null);
	/** Whether the repository had its file when this page last looked: the file appearing is what is offered on. */
	const had = useRef<boolean | null>(null);
	// Asked again when the agent's turn ends and when the window comes back:
	// the file is written by the agent, or by hand in an editor, and neither
	// is heard here.
	const working = useSyncExternalStore(configStore.subscribe, configStore.get)?.isStreaming ?? false;
	useEffect(() => {
		if (!shell?.runs || !path) return;
		let live = true;
		const ask = () => shell.runs!.state(path).then((next) => live && setState(next));
		ask();
		window.addEventListener("focus", ask);
		const off = shell.runs.onChange((at, next) => at === path && live && setState(next));
		return () => {
			live = false;
			window.removeEventListener("focus", ask);
			off();
		};
	}, [path, working]);
	// The file appearing under this page — the agent drafted it, or it was
	// written by hand — is an offer, once: setup runs on its own only in a
	// workspace being made, and this one is already made. Not run unasked,
	// since what is here may have been installed by hand already.
	useEffect(() => {
		if (!state) return;
		const was = had.current;
		had.current = state.configured;
		if (was === false && state.configured && path) {
			toast("The repository's commands are written down.", {
				id: "set-up-now",
				description: "Commit the file and every new workspace runs its setup. This one can run it now.",
				action: { label: "Run setup", onClick: () => runSetup(path) },
			});
		}
	}, [state, path]);
	if (!shell?.runs || !path || !state) return null;
	const face = "ml-auto cursor-default gap-1 px-1.5 text-xs font-normal";
	if (!state.configured) {
		return (
			<Button
				id="set-up"
				variant="ghost"
				size="sm"
				className={face}
				title="This repository has no .octave/config.toml — nothing is set up, run or checked for it. Ask the agent to draft one from what is there."
				onClick={() => send({ type: "prompt", text: "/setup", command: true, behavior: "followUp" })}
			>
				<WrenchIcon className="size-3" />
				<span>Set up</span>
			</Button>
		);
	}
	const run = state.run;
	const died = run !== null && !run.running && run.exit !== null && run.exit !== 0;
	// One run at a time in a workspace: the one going is the one to stop, and
	// the others wait for it — a second dev server on the same port would not
	// be a second run but a broken one.
	const start = (id: string) =>
		shell.runs!.start(path, id).then((result) => {
			if (result?.error) toast.error(result.error);
			else if (result?.state) setState(result.state);
		});
	const stop = () => void shell.runs!.stop(path);
	const setUpAgain = () => runSetup(path);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					id="scripts"
					variant="ghost"
					size="sm"
					className={face}
					data-running={run?.running || undefined}
					data-exit={run?.exit ?? undefined}
					title={run ? (run.running ? `${run.id} is running on port ${run.port}` : died ? `${run.id} ended with exit ${run.exit}` : `Run ${run.id}`) : "The repository's commands"}
				>
					{run ? run.running ? <SquareIcon className="size-3" /> : <PlayIcon className="size-3" /> : <WrenchIcon className="size-3" />}
					<span>{run?.id ?? "Scripts"}</span>
					{run?.running && <span className="font-mono text-muted-foreground">:{run.port}</span>}
					{died && <span aria-label={`exit ${run.exit}`} className="size-1.5 rounded-full bg-destructive" />}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent id="scripts-menu" side="top" align="end" className="min-w-52">
				{state.runs.map((id) => {
					const going = run?.running === true && run.id === id;
					return (
						<DropdownMenuItem key={id} id={`scripts-run-${id}`} data-run={id} disabled={run?.running === true && !going} onSelect={() => (going ? stop() : start(id))}>
							{going ? <SquareIcon /> : <PlayIcon />}
							{going ? `Stop ${id}` : `Run ${id}`}
							{died && run.id === id && <span className="ml-auto text-xs text-destructive">exit {run.exit}</span>}
						</DropdownMenuItem>
					);
				})}
				{run?.running && (
					<DropdownMenuItem asChild>
						<a id="scripts-open" href={`http://localhost:${run.port}/`} target="_blank" rel="noreferrer">
							<ExternalLinkIcon />
							Open localhost:{run.port}
						</a>
					</DropdownMenuItem>
				)}
				{(state.runs.length > 0 || state.logs.length > 0) && <DropdownMenuSeparator />}
				{state.logs.map((log) => (
					<DropdownMenuItem key={log.path} data-log={log.name} onSelect={() => onOpen(log.path)}>
						<FileTextIcon />
						{log.name}.log
						{log.exit !== null && <span className={`ml-auto text-xs ${log.exit === 0 ? "text-muted-foreground" : "text-destructive"}`}>exit {log.exit}</span>}
					</DropdownMenuItem>
				))}
				{state.logs.length > 0 && <DropdownMenuSeparator />}
				<DropdownMenuItem id="scripts-setup" onSelect={setUpAgain}>
					<RotateCwIcon />
					Run setup again
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
