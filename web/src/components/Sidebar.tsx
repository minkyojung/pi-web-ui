import { Settings } from "./Settings";

/**
 * The left column. Its header is the window's own top-left corner — the
 * traffic lights sit in that row, which is why it has a fixed height rather
 * than one its contents decide — and the settings live there because they are
 * about the window and the agent, not about anything in the column below.
 *
 * What the column lists is the next thing to decide; until then it says so.
 */
export function Sidebar() {
	return (
		<nav className="flex h-full flex-col border-r">
			<div className="drag-region titlebar-inset flex h-11 shrink-0 items-center justify-end border-b px-2">
				<Settings />
			</div>
			<div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
				Nothing here yet
			</div>
		</nav>
	);
}
