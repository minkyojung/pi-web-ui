import { Fragment, useState, useSyncExternalStore } from "react";
import { ChevronDownIcon } from "lucide-react";

import { SPEC_DOCS } from "../../../documentKinds.ts";
import type { SpecInfo } from "../../../protocol.ts";
import { commandsStore, configStore, specsStore } from "../serverState";
import { APPROVE, approveMessage, blocked, why } from "../specApprove.ts";
import { docPath, docStanding, docTitle, mine, progressWords, speaksFor, standingOf, standingWord, stateWords } from "../specStanding.ts";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";

/**
 * The spec, at the start of the row of tabs.
 *
 * A spec is three documents written in turn, each waiting for the person
 * before the next — and which one is waiting is the whole of what they have
 * to do next. That cannot live in a tab: a tab is a path, closed and reopened
 * and dragged about, and this is a fact about the workspace, true whether or
 * not any of the three is open. So it sits before the tabs, outside the row
 * they scroll in, and is simply absent while the folder has no spec — its
 * being there is itself the news that one has started.
 *
 * It names one spec: the one waiting, since that is the one with something to
 * do; else the one being read. Its menu holds every spec this workspace
 * started (specStanding.ts mine), so with two of them nothing of the work
 * here is hidden — and nothing of another branch's, which the folder is full
 * of, is put in front of the person as though it were. Each document says
 * what has become of it. A document the agent has not written is not offered
 * — opening it would put a file in front of the person that does not exist.
 *
 * Approving from here sends the command the person would type (specApprove.ts).
 * The menu is where it belongs as well as the bar over the document: the bar
 * needs the document open, and the answer is owed whether or not it is.
 */
export function SpecButton({ open, onOpen }: { open: string | null; onOpen: (path: string) => void }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const commands = useSyncExternalStore(commandsStore.subscribe, commandsStore.get);
	// The one approval already sent, by spec and document. It clears itself:
	// the next word from the server is a different document waiting, or none.
	const [sent, setSent] = useState<string | null>(null);

	const named = specs && speaksFor(specs, open);
	if (!specs || !named) return null;

	const stop = (spec: SpecInfo) =>
		blocked({
			online,
			streaming: config?.isStreaming ?? false,
			compacting: config?.isCompacting ?? false,
			hasCommand: commands.some((command) => command.name === APPROVE),
			sent: sent === mark(spec),
		});
	const approve = (spec: SpecInfo) => {
		if (!spec.waiting) return;
		send(approveMessage(spec.name));
		setSent(mark(spec));
	};

	const { standing } = standingOf(named);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					id="spec"
					data-standing={standing}
					aria-label={`${named.name}: ${stateWords(named)}`}
					className="ml-1 h-8 max-w-64 shrink-0 gap-1.5 px-2 text-xs shadow-none"
				>
					{/* The name gives up letters before the state does: half a name
					    still says which spec, and half a state says nothing. */}
					<span className="min-w-0 truncate" title={named.name}>
						{named.name}
					</span>
					<span className="shrink-0 text-muted-foreground/80">{stateWords(named)}</span>
					<ChevronDownIcon className="size-3 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-56">
				{mine(specs).map((spec, at) => (
					<Fragment key={spec.name}>
						{at > 0 && <DropdownMenuSeparator />}
						<DropdownMenuGroup>
							{/* Each spec's progress beside its name, so that with several the
							    menu says where each has got to, not only the one in front. */}
							<DropdownMenuLabel className="flex items-center gap-2">
								<span className="min-w-0 truncate">{spec.name}</span>
								{progressWords(spec) && (
									<span className="ml-auto font-normal text-muted-foreground" data-progress={spec.name}>
										{progressWords(spec)}
									</span>
								)}
							</DropdownMenuLabel>
							{SPEC_DOCS.map((doc) => {
								const standing = docStanding(spec, doc);
								return (
									<DropdownMenuItem
										key={doc}
										data-spec={spec.name}
										data-doc={doc}
										data-standing={standing}
										disabled={standing === "unwritten"}
										onSelect={() => onOpen(docPath(spec.name, doc))}
									>
										{docTitle(doc)}
										<span className="ml-auto text-muted-foreground">{standingWord(standing)}</span>
									</DropdownMenuItem>
								);
							})}
							{/* Set apart from the three, being the one thing here that does
							    something rather than opening something. An item, not a button
							    inside one: a button in a menu item is not reachable from the
							    keyboard. */}
							{spec.waiting && <DropdownMenuSeparator />}
							{spec.waiting && (
								<DropdownMenuItem data-approve={spec.name} disabled={stop(spec) !== null} onSelect={() => approve(spec)}>
									Approve {docTitle(spec.waiting).toLowerCase()}
									{why(stop(spec)) && <span className="ml-auto text-muted-foreground">{why(stop(spec))}</span>}
								</DropdownMenuItem>
							)}
						</DropdownMenuGroup>
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** What was sent about, so that the same approval is not sent twice. */
const mark = (spec: SpecInfo) => `${spec.name}/${spec.waiting}`;
