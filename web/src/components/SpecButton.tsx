import { Fragment, useSyncExternalStore } from "react";
import { ChevronDownIcon } from "lucide-react";

import { SPEC_DOCS } from "../../../documentKinds.ts";
import { specsStore } from "../serverState";
import { docPath, docStanding, docTitle, mine, speaksFor, standingOf, standingWord, stateWords } from "../specStanding.ts";
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
 * do; else the one being read. Its menu is that spec's three documents, each
 * saying what has become of it — and nothing else: the spec's name is the
 * workspace's, in the list beside, how far its tasks have got is the foot of
 * the window's, and approving is the header's of the document waiting, which
 * is read before it is approved. A document the agent has not written is not
 * offered — opening it would put a file in front of the person that does not
 * exist.
 *
 * A workspace can still hold more than one spec this workspace started
 * (specStanding.ts mine); the menu then holds each, under its name, so that
 * nothing of the work here is hidden — and nothing of another branch's, which
 * the folder is full of, is put in front of the person as though it were.
 */
export function SpecButton({ open, onOpen }: { open: string | null; onOpen: (path: string) => void }) {
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const named = specs && speaksFor(specs, open);
	if (!specs || !named) return null;

	const { standing } = standingOf(named);
	const here = mine(specs);
	const several = here.length > 1;
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
					className="ml-1 h-8 shrink-0 gap-1.5 px-2 text-xs shadow-none"
				>
					{/* Where the spec stands, not its name — which is the workspace's —
					    and in the text's own colour while a document waits for the
					    person, the one time it asks something of them. */}
					<span className={standing === "waiting" ? "text-foreground" : "text-muted-foreground"}>{stateWords(named)}</span>
					<ChevronDownIcon className="size-3 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-56">
				{here.map((spec, at) => (
					<Fragment key={spec.name}>
						{at > 0 && <DropdownMenuSeparator />}
						<DropdownMenuGroup>
							{/* Which spec, only where there is more than one to tell apart. */}
							{several && <DropdownMenuLabel className="truncate">{spec.name}</DropdownMenuLabel>}
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
						</DropdownMenuGroup>
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
