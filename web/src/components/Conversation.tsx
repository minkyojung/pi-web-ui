import { useSyncExternalStore } from "react";

import { promptsStore } from "../serverState";
import type { Item } from "../types";
import { ConversationView } from "./ConversationView";
import { PromptCard } from "./PromptCard";

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
		<ConversationView items={items}>
			<OpenPrompts />
		</ConversationView>
	);
}
