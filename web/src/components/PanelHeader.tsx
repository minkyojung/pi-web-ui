import { useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, PanelRight, PanelRightOpen, Pencil, Plus } from "lucide-react";

import type { SessionInfo } from "../types";
import { sessionsStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Input } from "./ui/input";
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
export const nameOf = (s: SessionInfo) => s.name ?? (s.messageCount === 0 ? "New session" : s.firstMessage);

/**
 * Every saved session for this folder, newest first, typed over to find one.
 *
 * A popover over a command list, which is what shadcn calls a combobox — not a
 * select, which cannot be searched and has to fit each entry on one line, and
 * these entries carry when they were last written to.
 *
 * It hangs off the name rather than a button of its own. The name is already
 * saying which session is open, and a list of the others is what you want from
 * it; a second control beside it would have been a second way to ask the same
 * question.
 */
function Sessions({ sessions, children }: { sessions: SessionInfo[]; children: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-0">
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
 * The conversation's name, and the pencil that opens it for changing.
 *
 * Two states, drawn as two things. A line of text while it is being read, so
 * it can be elided when it is too long; a field only while it is being
 * changed. It is a button in the first state, which is also the way to the
 * other sessions — so that part of the header is no longer somewhere to take
 * hold of the window by. The rows along the top of the window are, and they
 * are where a hand goes for that anyway.
 *
 * A conversation nobody has named reads by its first message, which is shown
 * but is not the value: the field opens empty, so a name nobody typed cannot
 * become one by being left alone. What that difference is for comes next —
 * a conversation that has never been named is the only one anything else may
 * name.
 *
 * The pencil appears under the pointer, as the copy and ask-again buttons on
 * a turn do. It is the only way in now: a double-click on the name cannot be
 * one when the first click has already opened a list.
 */
function SessionTitle({ sessions, current, online }: { sessions: SessionInfo[]; current: SessionInfo | undefined; online: boolean }) {
	const [editing, setEditing] = useState(false);
	const name = current?.name ?? "";
	const shown = current ? nameOf(current) : "New session";

	if (!editing) {
		return (
			<>
				{/* The chevron is kept until the pointer is here, as the pencil
				    beside it is: a header that draws every affordance it has at
				    rest is mostly affordances. */}
				<Sessions sessions={sessions}>
					<button
						id="sessionTitle"
						type="button"
						className="group/name -ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-sm font-medium hover:bg-accent"
					>
						<span className="min-w-0 truncate">{shown}</span>
						<ChevronDown className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-visible/name:opacity-100" />
					</button>
				</Sessions>
				{/* Nothing can be renamed while the socket is down, and a control that
				    still looked live would silently do nothing. */}
				{online && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="Rename"
								className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/header:opacity-100 focus-visible:opacity-100"
								onClick={() => setEditing(true)}
							>
								<Pencil />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">Rename</TooltipContent>
					</Tooltip>
				)}
			</>
		);
	}

	const close = (send_: boolean, box: HTMLInputElement) => {
		setEditing(false);
		if (!send_) return;
		const typed = box.value.trim();
		// pi would store what is already stored, and the answer would change nothing.
		if (typed === name) return;
		// Emptied on purpose: pi reads an empty name as the name being taken off,
		// and the first message stands in for it again.
		send({ type: "set_session_name", name: typed });
	};

	return (
		<Input
			id="sessionTitle"
			// Opened on the name itself, not on what stands in for one, and with it
			// chosen: the common reason to open this is to replace it.
			defaultValue={name}
			placeholder={shown}
			aria-label="Conversation name"
			spellCheck={false}
			autoFocus
			onFocus={(e) => e.currentTarget.select()}
			className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm font-medium shadow-none placeholder:text-foreground focus-visible:ring-0 dark:bg-transparent"
			onKeyDown={(e) => {
				if (e.nativeEvent.isComposing) return;
				if (e.key === "Enter") {
					e.preventDefault();
					close(true, e.currentTarget);
				} else if (e.key === "Escape") {
					e.preventDefault();
					close(false, e.currentTarget);
				}
			}}
			onBlur={(e) => close(true, e.currentTarget)}
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
		<div id="settings" className="group/header drag-region flex h-11 shrink-0 items-center gap-1 pr-2 pl-3">
			<SessionTitle sessions={sessions} current={current} online={online} />
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
		</div>
	);
}
