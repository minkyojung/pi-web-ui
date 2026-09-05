import { useSyncExternalStore } from "react";

import { promptsStore } from "../serverState";
import type { Item } from "../types";
import { Conversation as Scroller, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";
import { ItemView } from "./Item";
import { PromptCard } from "./PromptCard";

/**
 * The scroll container. use-stick-to-bottom replaces the hand-rolled follow
 * logic that had to record the user's scrolls to avoid measuring after new
 * content had already changed scrollHeight; it watches the content instead,
 * and brings a jump-to-bottom button with it.
 */
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

export function Conversation({ items }: { items: Item[] }) {
	return (
		<Scroller className="relative flex-1 overflow-y-auto">
			<ConversationContent id="chat" className="flex flex-col gap-3 p-3">
				{/* Items are only ever appended, never reordered, so the index is a stable key. */}
				{items.map((item, i) => (
					<ItemView key={i} item={item} />
				))}
				<OpenPrompts />
			</ConversationContent>
			<ConversationScrollButton />
		</Scroller>
	);
}
