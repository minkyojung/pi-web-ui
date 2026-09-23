/**
 * A mock of the tasks view — what a spec's tasks.md would look like read as
 * a plan, as progress and as results — drawn with the app's own components
 * on made-up data, to be looked at before anything is built over the editor.
 * Nothing here runs anything; the preset changes only how the same eight
 * tasks are folded, ordered and chipped. `?tasks` on the gallery page.
 */
import { useState } from "react";
import { CheckIcon, CircleDashedIcon, CircleDotIcon, CircleIcon, MoonIcon, PlayIcon, SunIcon, XIcon } from "lucide-react";

import { cn } from "cn";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../components/ui/hover-card";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../components/ui/context-menu";
import { Spinner } from "../components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";

type Standing = "todo" | "next" | "running" | "done" | "cancelled";
type Check = "pass" | "fail" | "said" | null;
interface Task {
	number: string;
	title: string;
	involves: string[];
	requirements: string[];
	doneWhen: string | null;
	after: string[];
	standing: Standing;
	commit?: { hash: string; added: number; deleted: number; check: Check; checkSays?: string };
}
interface Section { title: string; tasks: Task[] }

const plan: Section[] = [
	{
		title: "Backend",
		tasks: [
			{ number: "1", title: "Add the users table and the session token", involves: ["a migration in db/, the token helper in auth/token.ts"], requirements: ["1.1", "1.2"], doneWhen: "npm test -- auth", after: [], standing: "todo" },
			{ number: "2", title: "Sign-in endpoint", involves: [], requirements: [], doneWhen: null, after: [], standing: "todo" },
			{ number: "2.1", title: "POST /login validates and issues a token", involves: ["routes/login.ts; the cookie is httpOnly"], requirements: ["1.3"], doneWhen: "curl returns 200 with a cookie", after: [], standing: "todo" },
			{ number: "2.2", title: "Rate limit sign-in attempts", involves: ["a counter per address in memory, 5 a minute"], requirements: ["1.4"], doneWhen: "the sixth try in a minute returns 429", after: ["2.1"], standing: "todo" },
		],
	},
	{
		title: "UI",
		tasks: [
			{ number: "3", title: "Sign-in form", involves: ["components/SignIn.tsx and its route", "errors under the field, not in a toast"], requirements: ["2.1"], doneWhen: "e2e: signs in and lands on the folder", after: ["2.1"], standing: "todo" },
			{ number: "4", title: "Remember me", involves: ["a longer-lived token when the box is ticked"], requirements: ["2.2"], doneWhen: "e2e: still signed in after a reload", after: ["2.2"], standing: "todo" },
			{ number: "5", title: "Sign-out", involves: ["a menu item; the cookie cleared"], requirements: ["2.3"], doneWhen: "e2e: signed out lands on the form", after: [], standing: "todo" },
			{ number: "6", title: "Error states", involves: ["wrong password, locked out, server away"], requirements: ["2.4"], doneWhen: "e2e: each shows its line", after: ["3"], standing: "todo" },
		],
	},
];

const withStanding = (sections: Section[], of: (t: Task) => Partial<Task>): Section[] => sections.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t, ...of(t) })) }));

const progress = withStanding(plan, (t) => {
	if (["1", "2.1"].includes(t.number)) return { standing: "done", commit: { hash: t.number === "1" ? "a1b2c3d" : "d4e5f67", added: t.number === "1" ? 180 : 64, deleted: 2, check: "pass" } };
	if (t.number === "2") return { standing: "done" };
	if (t.number === "2.2") return { standing: "running" };
	if (t.number === "3") return { standing: "next" };
	return {};
});

const results = withStanding(plan, (t) => {
	const commits: Record<string, Task["commit"]> = {
		"1": { hash: "a1b2c3d", added: 180, deleted: 2, check: "pass" },
		"2.1": { hash: "d4e5f67", added: 64, deleted: 0, check: "pass" },
		"2.2": { hash: "0789abc", added: 31, deleted: 4, check: "fail", checkSays: "sixth try returned 200" },
		"3": { hash: "cdef012", added: 210, deleted: 0, check: "pass" },
		"4": { hash: "2345678", added: 40, deleted: 1, check: "said" },
		"6": { hash: "89abcde", added: 55, deleted: 3, check: "pass" },
	};
	if (t.number === "5") return { standing: "cancelled" };
	if (t.number === "2") return { standing: "done" };
	return { standing: "done", commit: commits[t.number] };
});

/** requirements.md, as far as the cards need it: each number's line. */
const REQUIREMENTS: Record<string, string> = {
	"1.1": "A person has an account, made with an email and a password.",
	"1.2": "A signed-in person is known by a token the browser keeps, not by the password.",
	"1.3": "A person signs in with their email and password and lands on their folder.",
	"1.4": "Sign-in attempts are limited, so a password cannot be guessed by trying.",
	"2.1": "The sign-in form says what is wrong under the field, not in a toast.",
	"2.2": "Ticking Remember me keeps the person signed in across restarts.",
	"2.3": "Sign-out is a menu item, and lands on the sign-in form.",
	"2.4": "Each way sign-in can fail has its own line: wrong password, locked out, server away.",
};

/** What each check printed — the tail of `.pi/runs/<n>.log`, as the card shows it. */
const LOGS: Record<string, string[]> = {
	"1": ["$ npm test -- auth", "", "> octave@0.0.9 test", "> node --test auth", "", "✔ a token is issued for a known email and password (12.4ms)", "✔ an unknown email is refused without saying which (3.1ms)", "✔ a wrong password is refused the same way (2.9ms)", "✔ the token names the user and expires in a day (1.8ms)", "", "ℹ tests 4", "ℹ pass 4", "ℹ fail 0", "", "exit 0"],
	"2.1": ["$ curl -si -X POST localhost:3000/login -d 'email=a@b.c&password=pw'", "HTTP/1.1 200 OK", "set-cookie: session=eyJhbGciOi…; HttpOnly; SameSite=Lax", "content-type: application/json", "", "{\"ok\":true}", "", "exit 0"],
	"2.2": ["$ for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code}\\n' -X POST localhost:3000/login -d 'email=a@b.c&password=no'; done", "401", "401", "401", "401", "401", "200", "", "expected the sixth to be 429, got 200", "", "exit 1"],
	"3": ["$ npm run e2e -- 'signs in and lands'", "", "  ok  signs in and lands on the folder", "1/1 passed", "", "exit 0"],
	"6": ["$ npm run e2e -- 'each shows its line'", "", "  ok  each way sign-in can fail shows its line", "1/1 passed", "", "exit 0"],
};

const presets = { plan, progress, results } as const;
type Preset = keyof typeof presets;

function Glyph({ standing, blocked, started }: { standing: Standing; blocked: boolean; started: boolean }) {
	const size = "size-4 shrink-0";
	// Waiting on another task is only news once something has run.
	if (started && blocked && (standing === "todo" || standing === "next")) return <CircleDashedIcon className={cn(size, "text-muted-foreground/45")} strokeWidth={1.75} />;
	switch (standing) {
		case "todo": return <CircleIcon className={cn(size, "text-muted-foreground/45")} strokeWidth={1.75} />;
		case "next": return <CircleDotIcon className={cn(size, "text-foreground")} strokeWidth={2} />;
		case "running": return <span className={cn(size, "relative flex items-center justify-center")}><span className="absolute inset-0 rounded-full border-2 border-amber-500/30" /><span className="absolute inset-0 rounded-full border-2 border-amber-500 border-r-transparent border-b-transparent animate-spin" /></span>;
		case "done": return <span className={cn(size, "flex items-center justify-center rounded-full bg-primary text-primary-foreground")}><CheckIcon className="size-2.5" strokeWidth={3.5} /></span>;
		case "cancelled": return <span className={cn(size, "flex items-center justify-center rounded-full bg-muted-foreground/35 text-background")}><XIcon className="size-2.5" strokeWidth={3} /></span>;
	}
}

/** A row is skimmed: a glyph, a title, and in Results one number and a mark. Everything else is read, in the row opened. */
function Row({ task, all, started }: { task: Task; all: Task[]; started: boolean }) {
	const parent = all.some((t) => t.number.startsWith(`${task.number}.`));
	const children = all.filter((t) => t.number.startsWith(`${task.number}.`));
	const doneChildren = children.filter((t) => t.standing === "done").length;
	const muted = task.standing === "done" || task.standing === "cancelled";
	const [open, setOpen] = useState(false);
	const waits = task.after.filter((n) => all.find((t) => t.number === n)?.standing !== "done");
	const blocked = waits.length > 0;
	const detail = task.involves.length > 0 || (task.doneWhen && !task.commit) || task.after.length > 0;
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<CollapsibleTrigger asChild disabled={!detail || parent}>
						<div
							data-standing={task.standing}
							className={cn(
								"flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 hover:bg-accent/50",
								task.standing === "running" && "bg-primary/[0.06] hover:bg-primary/[0.08]",
								task.number.includes(".") && "ml-6",
							)}
						>
							<Glyph standing={task.standing} blocked={blocked} started={started} />
							<span
								className={cn(
									"min-w-0 flex-1 truncate text-sm",
									muted && "text-muted-foreground",
									started && blocked && !muted && "text-muted-foreground",
									task.standing === "cancelled" && "line-through",
									task.standing === "next" && "font-medium",
									parent && "font-medium",
								)}
							>
								{task.title}
							</span>
							<span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
								{task.requirements.length > 0 && !parent && (
									<HoverCard openDelay={200} closeDelay={100}>
										<HoverCardTrigger asChild>
											<Badge variant="secondary" className="h-5 cursor-default rounded px-1.5 font-normal text-[11px] tabular-nums text-muted-foreground/80 hover:text-foreground" onClick={(e) => e.stopPropagation()}>
												{task.requirements[0]}{task.requirements.length > 1 && ` +${task.requirements.length - 1}`}
											</Badge>
										</HoverCardTrigger>
										<HoverCardContent side="bottom" align="end" className="w-80 space-y-1.5 text-[13px] leading-snug">
											{task.requirements.map((r) => <p key={r}><span className="mr-1.5 tabular-nums text-muted-foreground">{r}</span>{REQUIREMENTS[r]}</p>)}
										</HoverCardContent>
									</HoverCard>
								)}
								{parent && <span>{doneChildren} / {children.length}</span>}
								{task.commit && <span className="text-muted-foreground/70">+{task.commit.added} −{task.commit.deleted}</span>}
								{task.commit && task.doneWhen && (
									<HoverCard openDelay={250} closeDelay={150}>
										<HoverCardTrigger asChild>
											<button className="flex items-center" onClick={(e) => e.stopPropagation()} aria-label="what the check printed">
												{task.commit.check === "pass" && <CheckIcon className="size-3.5 text-muted-foreground/70" />}
												{task.commit.check === "fail" && <XIcon className="size-3.5 text-destructive/60" />}
												{task.commit.check === "said" && <CircleDashedIcon className="size-3.5 text-muted-foreground/50" />}
											</button>
										</HoverCardTrigger>
										<HoverCardContent side="bottom" align="end" className="w-[32rem] p-0 text-left">
											<div className="flex items-center gap-2 border-b px-3 py-2 font-mono text-[12px]">
												<PlayIcon className="size-3 shrink-0 text-muted-foreground/60" />
												<span className="min-w-0 flex-1 truncate">{task.doneWhen}</span>
												<span className={cn("shrink-0 text-[11px]", task.commit.check === "fail" ? "text-destructive/80" : "text-muted-foreground")}>
													{task.commit.check === "fail" ? "exit 1" : task.commit.check === "pass" ? "exit 0" : "not run — the agent said it passed"}
												</span>
											</div>
											{LOGS[task.number] ? (
												<ScrollArea className="h-56">
													<pre className="px-3 py-2 font-mono text-[12px] leading-5 text-muted-foreground whitespace-pre-wrap">{LOGS[task.number].map((line, i) => <div key={i} className={cn(line.startsWith("expected") && "text-destructive/80", line.startsWith("$ ") && "text-foreground")}>{line || " "}</div>)}</pre>
												</ScrollArea>
											) : (
												<p className="px-3 py-2 text-[12px] text-muted-foreground">Nothing was printed.</p>
											)}
											<div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground/70">Click to open the whole of it in a tab</div>
										</HoverCardContent>
									</HoverCard>
								)}
							</span>
						</div>
					</CollapsibleTrigger>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-52">
					<ContextMenuItem><PlayIcon />Run this task</ContextMenuItem>
					{task.commit && <ContextMenuItem>Open the commit</ContextMenuItem>}
					<ContextMenuItem>Show in file</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem variant="destructive">Cancel</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<CollapsibleContent>
				<div className={cn("mb-2.5 ml-[2.4rem] space-y-1.5 text-[13px] text-muted-foreground", task.number.includes(".") && "ml-[3.9rem]")}>
					{task.involves.map((line) => <p key={line}>{line}</p>)}
					{/* What proves it, while it is still to be run; once run, the mark on the row has it. */}
					{task.doneWhen && !task.commit && (
						<div className="flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
							<PlayIcon className="size-3 text-muted-foreground/60" />
							<span>{task.doneWhen}</span>
						</div>
					)}
					{task.after.length > 0 && (
						<div className="flex items-center gap-1.5">
							{task.after.map((n) => (
								<Tooltip key={n}>
									<TooltipTrigger asChild>
										<Badge variant="outline" className="h-5 cursor-default rounded px-1.5 font-normal text-[11px] tabular-nums text-muted-foreground hover:text-foreground">⇢ {n}</Badge>
									</TooltipTrigger>
									<TooltipContent side="bottom">after {n} · {all.find((t) => t.number === n)?.title}</TooltipContent>
								</Tooltip>
							))}
						</div>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function SectionView({ section, all, started }: { section: Section; all: Task[]; started: boolean }) {
	const own = section.tasks.filter((t) => !all.some((o) => o.number.startsWith(`${t.number}.`)));
	const done = own.filter((t) => t.standing === "done" || t.standing === "cancelled").length;
	return (
		<section className="mb-5">
			<div className="mb-1 flex h-7 items-center justify-between px-2">
				<h3 className="text-xs font-medium text-muted-foreground">{section.title}</h3>
				<span className="text-xs tabular-nums text-muted-foreground/60">{done} / {own.length}</span>
			</div>
			{section.tasks.map((t) => <Row key={t.number} task={t} all={all} started={started} />)}
		</section>
	);
}

export function TasksMock() {
	const initial = (new URLSearchParams(location.search).get("preset") as Preset) || "plan";
	const [preset, setPreset] = useState<Preset>(presets[initial] ? initial : "plan");
	const [dark, setDark] = useState(document.documentElement.dataset.theme?.includes("dark") ?? false);
	const sections = presets[preset];
	const all = sections.flatMap((s) => s.tasks);
	const started = all.some((t) => t.standing !== "todo" && t.standing !== "next");
	const own = all.filter((t) => !all.some((o) => o.number.startsWith(`${t.number}.`)));
	const count = (s: Standing) => own.filter((t) => t.standing === s).length;
	const toggleTheme = () => {
		const next = !dark;
		setDark(next);
		document.documentElement.dataset.theme = next ? "octave-dark" : "octave-light";
	};
	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
				<span className="text-sm text-muted-foreground">email-auth <span className="mx-1">›</span> tasks</span>
				{/* Not a control of the product's: the mock's way to show the same list at three moments. */}
				<Tabs value={preset} onValueChange={(v) => setPreset(v as Preset)} className="ml-auto opacity-50">
					<TabsList className="h-7 bg-transparent">
						<TabsTrigger value="plan" className="h-6 px-2.5 text-xs">before</TabsTrigger>
						<TabsTrigger value="progress" className="h-6 px-2.5 text-xs">during</TabsTrigger>
						<TabsTrigger value="results" className="h-6 px-2.5 text-xs">after</TabsTrigger>
					</TabsList>
				</Tabs>
				<Button variant="ghost" size="icon-xs" onClick={toggleTheme} aria-label="theme">{dark ? <SunIcon /> : <MoonIcon />}</Button>
			</header>
			<main className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[68ch] px-6 py-6">
					{sections.map((s) => <SectionView key={s.title} section={s} all={all} started={started} />)}
				</div>
			</main>
			<footer className="flex h-8 shrink-0 items-center gap-3 border-t px-4 text-xs text-muted-foreground">
				<span>{count("done")} done</span>
				{count("running") > 0 && <span className="text-primary">{count("running")} running</span>}
				{count("cancelled") > 0 && <span>{count("cancelled")} cancelled</span>}
				<span>{count("todo") + count("next")} to do</span>
			</footer>
		</div>
	);
}
