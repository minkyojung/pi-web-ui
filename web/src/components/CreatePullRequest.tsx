import { ChevronDownIcon, GitPullRequestCreateArrowIcon, GitPullRequestDraftIcon } from "lucide-react";

import { CREATE_PR } from "../pullRequestCommands";
import { useCommand, Why } from "./CommandButton";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

/**
 * The second item before there is a pull request: Create PR, and behind its
 * arrow Create draft PR — Conductor's pair, where Conductor has it. Pressed,
 * it sends /create-pr, and the agent commits what is left, pushes, and opens
 * the pull request (pullRequest.ts); once GitHub has it, the item is the
 * pull request's (PullRequestStanding.tsx). When it cannot be pressed, and
 * why, is every command button's (CommandButton.tsx).
 */
export function CreatePullRequest() {
	const { why, run } = useCommand(CREATE_PR);
	return (
		<Why why={why}>
			<ButtonGroup id="create-pr" className="mx-1.5">
				<Button variant="outline" size="xs" className="cursor-default font-normal" disabled={why !== null} onClick={() => run()}>
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
						<DropdownMenuItem id="create-draft-pr" onSelect={() => run("draft")}>
							<GitPullRequestDraftIcon />
							Create draft PR
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</ButtonGroup>
		</Why>
	);
}
