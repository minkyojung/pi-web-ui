import { useSyncExternalStore } from "react";

import type { SessionInfo } from "../types";
import { inRow } from "../piLayout";
import { sessionsStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { nameOf } from "./PanelHeader";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

/**
 * pi in the dock, as Linear places its agent: a row along the bottom of the
 * window that is always there, and a window over the corner that comes and
 * goes.
 *
 * The row is the sessions, the newest few, as tabs — a tab says which one,
 * the way the note tabs above say which note; there is no content under it,
 * the window is where the picked one is read. Nothing else is on the row:
 * a new session and the full history are in pi's own header, in the window.
 *
 * The window is a plain fixed box, not a sheet or a dialog: it is not modal,
 * the note under it is still being written, and a click outside it is a
 * click in the note, not a way to close it. ⌘\ and the toggle are.
 */
export function DockBar({ onPick }: { onPick: (session: SessionInfo) => void }) {
	const sessions = useSyncExternalStore(sessionsStore.subscribe, sessionsStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const row = inRow(sessions);
	const current = row.find((s) => s.current);
	return (
		<Tabs
			id="dock"
			value={current?.path ?? ""}
			// The value changes only to another session; the window opens on the
			// click, so the one tab there is opens it too.
			onValueChange={(path) => send({ type: "resume_session", path })}
			className="h-8 shrink-0 items-center border-t px-2 data-[orientation=horizontal]:flex-row"
		>
			<TabsList variant="line" className="group-data-[orientation=horizontal]/tabs:h-full no-scrollbar min-w-0 flex-1 justify-start gap-0 overflow-x-auto">
				{row.map((s) => (
					<TabsTrigger key={s.path} value={s.path} disabled={!online} onClick={() => onPick(s)} className="h-6 max-w-48 flex-none px-2 text-xs font-normal">
						<span className="truncate">{nameOf(s)}</span>
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
}

export function DockWindow({ children }: { children: React.ReactNode }) {
	return (
		<div
			id="dockWindow"
			className="fixed right-3 bottom-11 z-40 flex h-[70vh] w-[420px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border bg-popover shadow-lg"
		>
			{children}
		</div>
	);
}
