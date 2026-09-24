import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDownIcon, GitPullRequestCreateArrowIcon, GitPullRequestDraftIcon } from "lucide-react";

import { CREATE_PR, createPrMessage } from "../createPr";
import { commandsStore, configStore, noticesStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The second item before there is a pull request: Create PR, and behind its
 * arrow Create draft PR — Conductor's pair, where Conductor has it. Pressed,
 * it sends /create-pr, and the agent commits what is left, pushes, and opens
 * the pull request (pullRequest.ts); once GitHub has it, the item is the
 * pull request's (PullRequestStanding.tsx).
 *
 * Not pressable while the agent works — a command is refused then, not
 * queued (specApprove.ts) — nor again once pressed, until the turn starts or
 * the server says something back, which is how a refusal comes. Why not is
 * said on pointing at it.
 */
export function CreatePullRequest() {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const commands = useSyncExternalStore(commandsStore.subscribe, commandsStore.get);
	const notices = useSyncExternalStore(noticesStore.subscribe, noticesStore.get);
	const streaming = (config?.isStreaming ?? false) || (config?.isCompacting ?? false);
	const [sent, setSent] = useState(false);
	useEffect(() => setSent(false), [streaming, notices]);
	const why = !online ? "Not connected" : streaming ? "The agent is working" : !commands.some((command) => command.name === CREATE_PR) ? "Create PR is not loaded here" : sent ? "Asking the agent…" : null;
	const create = (draft: boolean) => {
		send(createPrMessage(draft));
		setSent(true);
	};
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{/* A disabled button gets no pointer events, so the tip hangs on a span round it. */}
				<span className="flex shrink-0 px-1.5">
					<ButtonGroup id="create-pr">
						<Button variant="outline" size="xs" className="cursor-default font-normal" disabled={why !== null} onClick={() => create(false)}>
							<GitPullRequestCreateArrowIcon />
							Create PR
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="icon-xs" className="cursor-default" disabled={why !== null} aria-label="More ways to open a pull request">
									<ChevronDownIcon />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent side="top" align="end">
								<DropdownMenuItem id="create-draft-pr" onSelect={() => create(true)}>
									<GitPullRequestDraftIcon />
									Create draft PR
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</ButtonGroup>
				</span>
			</TooltipTrigger>
			{why && <TooltipContent side="top">{why}</TooltipContent>}
		</Tooltip>
	);
}
