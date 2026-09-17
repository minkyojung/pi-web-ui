import { createContext, useContext, useSyncExternalStore } from "react";
import { GitForkIcon } from "lucide-react";

import { configStore } from "../serverState";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** How to ask for a fork; a context for the reason Navigate is one (see BranchSwitch). */
export const ForkFrom = createContext<(entryId: string) => void>(() => {});

/**
 * A new session that begins where this question does — everything before it
 * kept, everything after left where it is. pi's /fork: the question itself
 * comes back as text, to be sent as it was or changed first, which is where
 * this differs from asking again in place (AskAgain), which grows a branch of
 * the same session.
 */
export function Fork({ entryId }: { entryId: string }) {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const fork = useContext(ForkFrom);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label="Fork a new session from here"
					disabled={config?.isStreaming ?? false}
					className="opacity-0 transition-opacity group-hover/user:opacity-100 focus-visible:opacity-100"
					onClick={() => fork(entryId)}
				>
					<GitForkIcon />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">Fork a new session from here</TooltipContent>
		</Tooltip>
	);
}
