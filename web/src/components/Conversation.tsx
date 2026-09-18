import type { Item } from "../types";
import { send } from "../ws";
import { Navigate } from "./BranchSwitch";
import { ConversationView } from "./ConversationView";
import { ForkFrom } from "./Fork";

/**
 * Moving the session's leaf is the server's to do: it rebuilds the
 * conversation from the branch asked for and publishes it, and a user message
 * navigated to comes back as text to be asked again.
 */
const navigate = (entryId: string) => {
	send({ type: "navigate", entryId });
};

/** Forking is the server's too: it swaps the session and publishes the new one. */
const fork = (entryId: string) => {
	send({ type: "fork", entryId });
};

/** The conversation, with the ways to move the session that the server carries out. */
export function Conversation({ items }: { items: Item[] }) {
	return (
		<ForkFrom value={fork}>
			<Navigate value={navigate}>
				<ConversationView items={items} />
			</Navigate>
		</ForkFrom>
	);
}
