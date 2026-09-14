import { useSyncExternalStore } from "react";

import { cn } from "cn";

import { titleOf } from "../noteSync";
import { filesStore } from "../serverState";
import { Settings } from "./Settings";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The left column: the notes in the folder pi works in, newest first.
 *
 * The list comes from the server, which re-sends it after every write, so a
 * note pi just wrote is on it without anyone asking. A row opens its note in
 * the middle column, by way of the address.
 *
 * Its header is the window's own top-left corner: the traffic lights sit in
 * that row, which is why it has a fixed height rather than one its contents
 * decide. The settings live there because they are about the window and the
 * agent, not about anything in the column below.
 *
 * It paints in the sidebar tokens, not the page's. Every theme sets the column
 * a step off the page it sits beside — that is what the tokens are for — and a
 * column drawn in --background has no way to say it.
 */
export function Sidebar({ open, onOpen }: { open: string | null; onOpen: (path: string) => void }) {
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);

	return (
		<nav className="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
			<div className="drag-region titlebar-inset flex h-11 shrink-0 items-center justify-end border-b border-sidebar-border px-2">
				<Settings />
			</div>
			{files.length === 0 ? (
				<div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
					No notes in this folder yet
				</div>
			) : (
				// The rows are inset by the gutter the header keeps, so a row's
				// highlight ends where the settings button does.
				<ul id="notes" className="no-scrollbar flex-1 overflow-y-auto overscroll-contain px-2 py-1">
					{files.map((file) => (
						<li key={file.path}>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										data-path={file.path}
										data-active={file.path === open}
										aria-current={file.path === open ? "page" : undefined}
										onClick={() => onOpen(file.path)}
										className={cn(
											"h-8 w-full cursor-default justify-start px-2 font-normal",
											// The dark hover ghost carries is the page's accent at half
											// alpha, under a modifier tailwind-merge cannot line up with
											// the one above it, so it is named again here.
											"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent",
											// Inside the row: the list scrolls, and a ring drawn outside
											// the top row would be cut off by the edge it scrolls under.
											"focus-visible:ring-sidebar-ring/50 focus-visible:ring-inset",
											// Weight, not only colour — the open note and the one under
											// the pointer are the same surface, and something has to tell
											// them apart while the pointer is somewhere else.
											"data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
										)}
									>
										<span className="truncate">{titleOf(file.path)}</span>
										{/* The folder, where there is one, as ⌘P writes it: to the right,
										    quieter, and it gives way to the name when the column is narrow. */}
										{file.path.includes("/") && (
											<span className="ml-auto max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
												{file.path.slice(0, file.path.lastIndexOf("/"))}
											</span>
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent side="right">{file.path}</TooltipContent>
							</Tooltip>
						</li>
					))}
				</ul>
			)}
		</nav>
	);
}
