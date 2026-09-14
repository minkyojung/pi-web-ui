import { useRef, useState, useSyncExternalStore } from "react";
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
 * The conversation's name: the one thing in this header that is not a button.
 * A line of text until it is clicked, and a field after — the name belongs to
 * the conversation, so it is changed where it is shown rather than behind a
 * dialog, the way a note's title is in Title.tsx.
 *
 * A conversation nobody has named still reads by its first message, but that
 * is the placeholder and not the value: a name nobody typed should not become
 * one just because the field was focused and left. It is drawn in the same ink
 * as a real name, because to the person reading it there is no difference.
 *
 * Uncontrolled, and keyed on what pi kept: pi trims the name and takes the
 * line breaks out of it, so what is stored can differ from what was typed, and
 * remounting on the way back is what makes the box say what was kept.
 */
function SessionTitle({ current, online }: { current: SessionInfo | undefined; online: boolean }) {
	const box = useRef<HTMLInputElement>(null);
	const name = current?.name ?? "";
	const commit = () => {
		const typed = (box.current?.value ?? "").trim();
		// pi would store what is already stored; the round trip would buy nothing,
		// and nothing would come back to put the trimmed text in the box.
		if (typed === name) {
			if (box.current) box.current.value = name;
			return;
		}
		// Emptied on purpose: pi reads an empty name as the name being taken off,
		// and the first message is shown again.
		send({ type: "set_session_name", name: typed });
	};

	return (
		<input
			key={`${current?.id ?? "none"}:${name}`}
			ref={box}
			id="sessionTitle"
			type="text"
			defaultValue={name}
			placeholder={current ? nameOf(current) : "New session"}
			aria-label="Conversation name"
			spellCheck={false}
			// Read-only rather than disabled while the socket is down: the name is
			// something to read as much as something to change, and a disabled box
			// greys out what it is showing.
			readOnly={!online}
			className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-foreground"
			onKeyDown={(e) => {
				if (e.nativeEvent.isComposing) return;
				if (e.key === "Enter") {
					e.preventDefault();
					commit();
					e.currentTarget.blur();
				} else if (e.key === "Escape") {
					e.preventDefault();
					if (box.current) box.current.value = name;
					e.currentTarget.blur();
				}
			}}
			onBlur={commit}
		/>
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
			<SessionTitle current={current} online={online} />
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
