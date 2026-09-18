import { useState } from "react";
import { ChevronRightIcon, PauseIcon, PlayIcon, RotateCcwIcon, SkipForwardIcon } from "lucide-react";

import { ConversationView } from "../components/ConversationView";
import { Question } from "../components/Question";
import { ToolSummaries } from "../components/ToolRow";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { questions } from "./questions";
import { useReplay } from "./replay";
import { scenarios } from "./scenarios";

/**
 * A bench for the conversation view, on its own page.
 *
 * The point is to tune how a run reads without having to provoke a real one: a
 * failing tool, a compaction, four hundred deltas of a long answer. It is a
 * bench and not a mock — the events go through the same `applyEvent` the live
 * socket uses and come out of the same `ConversationView`, so what looks right
 * here looks the same in the app. What it does not share is the jar: its own
 * store, and no socket at all, so the session running in the other tab cannot
 * be touched from here.
 *
 * The conversation is framed rather than run edge to edge. pi's column is about
 * 30% of a window, and most of what is hard to read there is hard to read
 * because of that width — a bench that ignored it would tune the wrong thing.
 */

const SPEEDS = [0.5, 1, 4, 16];

/** The pi column's share of the window, which is what the frame starts at. */
const PI_PANEL_SHARE = 0.3;

export function GalleryPage() {
	const [id, setId] = useState(scenarios[0].id);
	const scenario = scenarios.find((s) => s.id === id) ?? scenarios[0];
	const [width, setWidth] = useState(() => Math.round(window.innerWidth * PI_PANEL_SHARE));
	const [showRaw, setShowRaw] = useState(false);
	// Off shows the same run the way it looked before tool headers carried a
	// summary, which is the only way to tell whether the summary is an improvement.
	const [summaries, setSummaries] = useState(true);

	// A question under the conversation, where the app puts one: in place of
	// the message box, which the bench does not have. What it was answered with
	// is shown rather than sent — there is no socket here to send it on.
	const [asking, setAsking] = useState("none");
	const [asked, setAsked] = useState(0);
	const [answered, setAnswered] = useState<string | null>(null);
	const question = questions.find((q) => q.id === asking);

	const replay = useReplay(scenario);

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<header className="flex flex-col gap-2 border-b px-3 py-2">
				<div className="flex flex-wrap items-center gap-2">
					<Select value={id} onValueChange={setId}>
						<SelectTrigger id="scenario" size="sm" className="w-64">
							<SelectValue />
						</SelectTrigger>
						{/* The name is what is read; the id is what the bench check asks for. */}
						<SelectContent>
							{scenarios.map((s) => (
								<SelectItem key={s.id} value={s.id} data-scenario={s.id}>
									{s.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<div className="flex items-center gap-0.5">
						<Button size="icon-sm" variant="ghost" title="Start" onClick={() => replay.seek(0)}>
							<RotateCcwIcon />
						</Button>
						<Button
							size="icon-sm"
							variant="ghost"
							title={replay.playing ? "Pause" : "Play"}
							disabled={replay.done}
							onClick={() => replay.setPlaying(!replay.playing)}
						>
							{replay.playing ? <PauseIcon /> : <PlayIcon />}
						</Button>
						<Button
							size="icon-sm"
							variant="ghost"
							title="Step"
							disabled={replay.done}
							onClick={() => {
								replay.setPlaying(false);
								replay.step();
							}}
						>
							<ChevronRightIcon />
						</Button>
						<Button
							size="icon-sm"
							variant="ghost"
							title="End"
							disabled={replay.done}
							onClick={() => {
								replay.setPlaying(false);
								replay.seek(replay.total);
							}}
						>
							<SkipForwardIcon />
						</Button>
					</div>

					<input
						type="range"
						min={0}
						max={replay.total}
						value={replay.cursor}
						aria-label="Event position"
						className="h-8 min-w-40 flex-1 accent-foreground"
						onChange={(e) => {
							replay.setPlaying(false);
							replay.seek(Number(e.target.value));
						}}
					/>
					<span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
						{replay.cursor}/{replay.total}
					</span>

					{/* Radix speaks in strings; the speed is a number. */}
					<Select value={String(replay.speed)} onValueChange={(v) => replay.setSpeed(Number(v))}>
						<SelectTrigger size="sm" aria-label="Speed" className="w-16">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SPEEDS.map((s) => (
								<SelectItem key={s} value={String(s)}>
									{s}×
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					{/* The frame's width, because it is half of what makes a run hard to read. */}
					<label className="flex items-center gap-2 text-xs text-muted-foreground">
						Width
						<input
							type="range"
							min={280}
							max={900}
							value={width}
							aria-label="Conversation width"
							className="h-8 w-28 accent-foreground"
							onChange={(e) => setWidth(Number(e.target.value))}
						/>
						<span className="w-12 tabular-nums">{width}px</span>
					</label>

					<Button size="xs" variant={showRaw ? "secondary" : "ghost"} onClick={() => setShowRaw((on) => !on)}>
						Events
					</Button>

					<Select
						value={asking}
						onValueChange={(v) => {
							setAsking(v);
							setAsked((n) => n + 1);
							setAnswered(null);
						}}
					>
						<SelectTrigger id="asking" size="sm" aria-label="Question" className="w-56">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="none">No question</SelectItem>
							{questions.map((q) => (
								<SelectItem key={q.id} value={q.id} data-question={q.id}>
									{q.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{scenario.note && <p className="text-xs leading-snug text-muted-foreground">{scenario.note}</p>}
			</header>

			<div className="flex min-h-0 flex-1">
				<div className="flex min-w-0 flex-1 justify-center overflow-hidden">
					{/* The same list the app mounts, at the width the app mounts it. */}
					<div className="flex min-h-0 flex-col border-x" style={{ width }}>
						<ToolSummaries value={summaries}>
							<ConversationView items={replay.items} />
						</ToolSummaries>
						{question && (
							<div className="flex max-h-[60%] shrink-0 flex-col p-3">
								<Question
									key={asked}
									prompt={question.prompt}
									streaming={question.streaming ?? false}
									autoFocus
									onAnswer={(answer) => (setAnswered(answer), true)}
									onCancel={() => (setAnswered("(closed without answering)"), true)}
									onStop={() => setAnswered("(the run was stopped)")}
								/>
							</div>
						)}
						{answered !== null && (
							<pre id="answered" className="shrink-0 border-t px-3 py-2 font-mono text-[11px] whitespace-pre-wrap">
								{answered}
							</pre>
						)}
					</div>
				</div>

				{/* The event that produced the last thing on screen, for when the two
				    do not obviously match. */}
				{showRaw && (
					<aside className="w-96 shrink-0 overflow-auto border-l bg-muted/30">
						<pre className="p-3 font-mono text-[11px] whitespace-pre-wrap">
							{replay.last ? JSON.stringify(replay.last, null, 2) : "—"}
						</pre>
					</aside>
				)}
			</div>
		</div>
	);
}
