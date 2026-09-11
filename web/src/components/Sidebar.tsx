import { useSyncExternalStore } from "react";

import { filesStore } from "../serverState";
import { Settings } from "./Settings";

/**
 * The left column: the notes in the folder pi works in, newest first.
 *
 * The list comes from the server, which re-sends it when a run settles, so a
 * note pi just wrote is on it without anyone asking. Nothing is opened yet —
 * the middle column is still empty — so a row is a name, not a control.
 *
 * Its header is the window's own top-left corner: the traffic lights sit in
 * that row, which is why it has a fixed height rather than one its contents
 * decide. The settings live there because they are about the window and the
 * agent, not about anything in the column below.
 */
export function Sidebar() {
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);

	return (
		<nav className="flex h-full flex-col border-r">
			<div className="drag-region titlebar-inset flex h-11 shrink-0 items-center justify-end border-b px-2">
				<Settings />
			</div>
			{files.length === 0 ? (
				<div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
					No notes in this folder yet
				</div>
			) : (
				<ul id="notes" className="flex-1 overflow-y-auto overscroll-contain py-1">
					{files.map((file) => (
						<li key={file.path} className="truncate px-4 py-1.5 text-sm" title={file.path}>
							{file.path.replace(/\.md$/, "")}
						</li>
					))}
				</ul>
			)}
		</nav>
	);
}
