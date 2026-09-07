import { useSyncExternalStore } from "react";

import { promptsStore } from "../serverState";
import type { Item } from "../types";
import { send } from "../ws";
import { Navigate } from "./BranchSwitch";
import { ConversationView } from "./ConversationView";
import { PromptCard } from "./PromptCard";

/**
 * Moving the session's leaf is the server's to do: it rebuilds the
 * conversation from the branch asked for and publishes it, and a user message
 * navigated to comes back as text to be asked again.
 */
const navigate = (entryId: string) => {
	send({ type: "navigate", entryId });
};

/**
 * Questions waiting on an answer, after the items. pi runs tool calls one at a
 * time, so while ask_user waits its tool card is the last item and the card
 * sits directly under it. Subscribes on its own so a new question does not
 * re-render the list above it.
 */
function OpenPrompts() {
	const prompts = useSyncExternalStore(promptsStore.subscribe, promptsStore.get);
	return prompts.map((prompt) => <PromptCard key={prompt.id} prompt={prompt} />);
}

/** The conversation, with the agent's open questions under it. */
export function Conversation({ items }: { items: Item[] }) {
	return (
		<Navigate value={navigate}>
			<ConversationView items={items}>
				<OpenPrompts />
			</ConversationView>
		</Navigate>
	);
}
