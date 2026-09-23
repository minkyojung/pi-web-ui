import { useEffect, useState } from "react";

import type { Mode } from "../readMode";
import { docPath } from "../specStanding.ts";
import type { ConfigMsg, SpecInfo } from "../../../protocol.ts";
import { ApproveAction } from "../components/ApproveAction";
import { RunActions } from "../components/RunActions";
import { NoteHeader } from "../components/NoteHeader";
import { ModeToggle, PiToggle } from "../components/PanelHeader";
import { Button } from "../components/ui/button";
import { pickTasks } from "../runOn";
import { commandsStore, configStore, specsStore } from "../serverState";
import { type Connection, getConnection, setConnection, subscribe } from "../store";

/**
 * A bench for the header of a spec's document: Approve, and what the tasks
 * run on with Run of a selection — the two controls that answer to the
 * agent's waiting, on their own page with the states they can be in.
 *
 * The controls are the app's own and read the app's own stores; the bench
 * only fills the stores. There is no socket, so a press sends nothing and the
 * control's own word for having sent — Approving…, Starting… — is what is
 * seen; the switches below say what the server would say back. Each state
 * is a button, so any of them is one press away and a change to the
 * control's look or motion is seen in every state without a real run.
 */

const MODELS: ConfigMsg["models"] = [
	{ key: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", levels: ["low", "medium", "high"], level: "medium" },
	{ key: "anthropic/claude-fable-5-1", name: "Claude Fable 5.1", levels: ["low", "medium", "high", "max"], level: "high" },
] as ConfigMsg["models"];

const config = (over: Partial<ConfigMsg> = {}): ConfigMsg =>
	({
		type: "config",
		model: MODELS[0]!.key,
		models: MODELS,
		tools: [],
		activeTools: [],
		isStreaming: false,
		isCompacting: false,
		pi: { compaction: { enabled: true, reserveTokens: 0, keepRecentTokens: 0 }, retryEnabled: true, hideThinkingBlock: false, askBranchSummary: false, projectTrust: "trusted" },
		queued: { steering: [], followUp: [] },
		sessionId: "bench",
		sessionName: null,
		run: null,
		folder: "/bench",
		log: "",
		...over,
	}) as ConfigMsg;

const SPEC = "email-auth";
const spec = (over: Partial<SpecInfo> = {}): SpecInfo => ({
	name: SPEC,
	own: true,
	approved: 0,
	waiting: "requirements.md",
	waitingAt: Date.now(),
	written: ["requirements.md"],
	tasks: null,
	results: [],
	...over,
});

const TASKS_READY: Partial<SpecInfo> = { approved: 2, waiting: null, written: ["requirements.md", "design.md", "tasks.md"], tasks: { total: 5, done: 1, cancelled: 0, next: "2", review: [] } };

/** The states, each a whole world: what is open, what the folder says, what the session is doing. */
const STATES: { id: string; name: string; path: string; specs: SpecInfo[]; config: ConfigMsg; online?: boolean; picked?: string[] }[] = [
	{ id: "waiting", name: "Requirements waiting", path: docPath(SPEC, "requirements.md"), specs: [spec()], config: config() },
	{ id: "design", name: "Design waiting", path: docPath(SPEC, "design.md"), specs: [spec({ approved: 1, waiting: "design.md", written: ["requirements.md", "design.md"] })], config: config() },
	{ id: "busy", name: "Waiting, agent working", path: docPath(SPEC, "requirements.md"), specs: [spec()], config: config({ isStreaming: true }) },
	{ id: "offline", name: "Waiting, not connected", path: docPath(SPEC, "requirements.md"), specs: [spec()], config: config(), online: false },
	{ id: "approved", name: "Approved (nothing waiting)", path: docPath(SPEC, "requirements.md"), specs: [spec({ approved: 1, waiting: "design.md", written: ["requirements.md"] })], config: config() },
	{ id: "tasks", name: "tasks.md, nothing picked", path: docPath(SPEC, "tasks.md"), specs: [spec(TASKS_READY)], config: config() },
	{ id: "picked", name: "tasks.md, 2 and 3 picked", path: docPath(SPEC, "tasks.md"), specs: [spec(TASKS_READY)], config: config(), picked: ["2", "3"] },
	{ id: "running", name: "tasks.md, 2.1 running", path: docPath(SPEC, "tasks.md"), specs: [spec({ ...TASKS_READY, tasks: { total: 5, done: 1, cancelled: 0, next: "2.2", review: [] } })], config: config({ isStreaming: true, run: { spec: SPEC, task: "2.1", title: "POST /login validates and issues a token", then: [] } }) },
	{ id: "note", name: "A plain note", path: "notes/today.md", specs: [spec()], config: config() },
];

// The socket module connects on import and, finding no server on this
// page, keeps saying "reconnecting"; the bench's word on the connection is
// held against it, so the controls see what the state says.
let wanted: Connection = "open";
subscribe(() => {
	if (getConnection() !== wanted) setConnection(wanted);
});

function apply(state: (typeof STATES)[number]): void {
	specsStore.set(state.specs);
	configStore.set(state.config);
	commandsStore.set([
		{ name: "spec-approve", source: "extension" },
		{ name: "spec-run", source: "extension" },
	]);
	wanted = state.online === false ? "reconnecting" : "open";
	setConnection(wanted);
	pickTasks(state.picked ? { spec: SPEC, numbers: state.picked } : null);
}

export function HeaderBench() {
	const [id, setId] = useState(STATES[0]!.id);
	const [width, setWidth] = useState(720);
	const [mode, setMode] = useState<Mode>("read");
	const [pi, setPi] = useState(true);
	const state = STATES.find((s) => s.id === id) ?? STATES[0]!;
	// The stores are filled after the render that chose the state, as the
	// socket would fill them: the controls hear it and draw themselves.
	useEffect(() => apply(state), [state]);

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<header className="flex flex-col gap-2 border-b px-3 py-2">
				<div className="flex flex-wrap items-center gap-1">
					{STATES.map((s) => (
						<Button key={s.id} size="xs" variant={s.id === id ? "secondary" : "ghost"} data-state={s.id} onClick={() => setId(s.id)}>
							{s.name}
						</Button>
					))}
					<label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
						Width
						<input type="range" min={360} max={1100} value={width} aria-label="Column width" className="h-8 w-28 accent-foreground" onChange={(e) => setWidth(Number(e.target.value))} />
						<span className="w-12 tabular-nums">{width}px</span>
					</label>
				</div>
				<p className="text-xs leading-snug text-muted-foreground">No socket: a press sends nothing, and shows the control's own word for having sent. Pick another state for what the server would say back.</p>
			</header>
			<div className="flex min-h-0 flex-1 justify-center overflow-hidden pt-6">
				<div className="flex min-h-0 flex-col rounded-xl border bg-background" style={{ width, height: 220 }}>
					<NoteHeader
						path={state.path}
						onOpen={() => {}}
						actions={<><ApproveAction path={state.path} /><RunActions path={state.path} /></>}
						trailing={<><ModeToggle mode={mode} onSwitch={() => setMode((m) => (m === "read" ? "edit" : "read"))} /><PiToggle open={pi} onToggle={() => setPi((on) => !on)} /></>}
					/>
					<div className="flex-1 px-6 py-4 text-sm text-muted-foreground">{state.path}</div>
				</div>
			</div>
		</div>
	);
}
