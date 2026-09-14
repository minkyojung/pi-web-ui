import { useState, useSyncExternalStore } from "react";
import { Check, History, PanelRight, PanelRightOpen, Plus } from "lucide-react";

import type { SessionInfo } from "../types";
import { sessionsStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** "just now", "5m", "3h", "2d", then the date: the list is sorted by this already. */
function ago(iso: string, now = Date.now()): string {
	const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
	return new Date(iso).toLocaleDateString();
}

/** A session with nothing in it has no first message to be named by; the server sends a placeholder, and the name is chosen here. */
const nameOf = (s: SessionInfo) => s.name ?? (s.messageCount === 0 ? "New session" : s.firstMessage);

/**
 * Every saved session for this folder, newest first, typed over to find one.
 * A popover from its own button rather than a select: a select cannot be
 * searched and has to fit each entry on one line, which is how the header
 * came to show message counts and timestamps.
 */
function SessionHistory({ sessions, disabled }: { sessions: SessionInfo[]; disabled: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button id="sessions" variant="ghost" size="icon-xs" aria-label="Session history" className="shrink-0 text-muted-foreground" disabled={disabled}>
							<History />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">Session history</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-80 p-0">
				<Command loop>
					<CommandInput placeholder="Find a session…" />
					<CommandList className="max-h-80">
						<CommandEmpty>No session by that name.</CommandEmpty>
						{sessions.map((s) => (
							<CommandItem
								key={s.path}
								value={`${nameOf(s)} ${s.id}`}
								onSelect={() => {
									setOpen(false);
									if (!s.current) send({ type: "resume_session", path: s.path });
								}}
							>
								<Check className={s.current ? "opacity-100" : "opacity-0"} />
								<span className="min-w-0 flex-1 truncate">{nameOf(s)}</span>
								<span className="shrink-0 text-xs text-muted-foreground">{ago(s.modified)}</span>
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The one control for whether the pi column is shown. It lives in the note
 * column's header, not the panel's own: a button that hides the panel it is in
 * leaves nothing to bring it back with. Always drawn, and the icon says which
 * way it will go — as VS Code's secondary side bar toggle does.
 */
export function PiToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					id="togglePi"
					variant="ghost"
					size="icon-xs"
					aria-label={open ? "Hide pi" : "Show pi"}
					aria-pressed={open}
					className="shrink-0 text-muted-foreground"
					onClick={onToggle}
				>
					{open ? <PanelRight /> : <PanelRightOpen />}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{open ? "Hide pi" : "Show pi"} ⌘\</TooltipContent>
		</Tooltip>
	);
}

/**
 * The pi column's header: the conversation's name on the left, what can be
 * done about it on the right. One height with the other two column headers,
 * so the top of the window reads as a single row.
 *
 * The status line that used to live here is now in the composer's footer,
 * beside the control it disables.
 */
export function PanelHeader() {
	const sessions = useSyncExternalStore(sessionsStore.subscribe, sessionsStore.get);
	// Nothing is queued while the socket is down, so a control that still looked
	// live would silently do nothing.
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const current = sessions.find((s) => s.current);

	return (
		<div id="settings" className="drag-region flex h-11 shrink-0 items-center gap-1 border-b pr-2 pl-3">
			<span id="sessionTitle" className="min-w-0 flex-1 truncate text-sm font-medium" title={current ? nameOf(current) : undefined}>
				{current ? nameOf(current) : "New session"}
			</span>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						id="newSession"
						variant="ghost"
						size="icon-xs"
						aria-label="New session"
						className="shrink-0 text-muted-foreground"
						disabled={!online}
						onClick={() => send({ type: "new_session" })}
					>
						<Plus />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">New session</TooltipContent>
			</Tooltip>
			<SessionHistory sessions={sessions} disabled={!online} />
		</div>
	);
}
