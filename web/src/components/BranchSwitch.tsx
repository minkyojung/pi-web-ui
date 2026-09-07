import { createContext, useContext, useSyncExternalStore } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { branchesStore, configStore } from "../serverState";
import { Button } from "./ui/button";

/**
 * How to ask for a different branch.
 *
 * Through a context rather than by reaching for the socket, because this
 * component is mounted by the gallery too, and importing the module that owns
 * the socket opens one. The bench gets arrows that do nothing, which is the
 * right answer there: it has no session to move.
 */
export const Navigate = createContext<(entryId: string) => void>(() => {});

/**
 * The other ways this question was asked.
 *
 * A pi session is a tree: asking something again leaves the first answer where
 * it was and grows a branch beside it. Until now the browser only ever saw the
 * path it happened to be on, so those answers existed in the file and nowhere
 * on screen. This is the way back to them.
 *
 * Not the registry's MessageBranch, which holds every branch as a rendered
 * child and switches between them in the browser. Here one branch exists at a
 * time: switching means asking the server to move the session's leaf and
 * publish the conversation that follows from it.
 *
 * It subscribes on its own rather than being handed its point, so a session
 * gaining a branch re-renders the arrows and not the conversation above them.
 */
export function BranchSwitch({ entryId }: { entryId: string }) {
	const branches = useSyncExternalStore(branchesStore.subscribe, branchesStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const navigate = useContext(Navigate);
	const point = branches.find((node) => node.entryId === entryId);

	// Silence is the common case: most questions were only asked once, and a
	// control that says "1 of 1" is a control that says nothing.
	if (!point) return null;

	// pi refuses to move the leaf mid-reply, and would be right to: the reply
	// is being written into the branch that would be left behind.
	const busy = config?.isStreaming ?? false;
	const go = (to: number) => navigate(point.targets[to]);

	return (
		<div className="flex items-center gap-0.5 text-xs text-muted-foreground">
			<Button
				size="icon-xs"
				variant="ghost"
				title="Previous answer"
				disabled={busy || point.index === 0}
				onClick={() => go(point.index - 1)}
			>
				<ChevronLeftIcon />
			</Button>
			<span className="tabular-nums">
				{point.index + 1}/{point.total}
			</span>
			<Button
				size="icon-xs"
				variant="ghost"
				title="Next answer"
				disabled={busy || point.index === point.total - 1}
				onClick={() => go(point.index + 1)}
			>
				<ChevronRightIcon />
			</Button>
		</div>
	);
}
