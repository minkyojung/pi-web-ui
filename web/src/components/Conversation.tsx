import { Conversation as Scroller, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";
import { ItemView } from "./Item";
import type { Item } from "../types";

/**
 * The scroll container. use-stick-to-bottom replaces the hand-rolled follow
 * logic that had to record the user's scrolls to avoid measuring after new
 * content had already changed scrollHeight; it watches the content instead,
 * and brings a jump-to-bottom button with it.
 */
export function Conversation({ items }: { items: Item[] }) {
	return (
		<Scroller className="relative flex-1 overflow-y-auto">
			<ConversationContent id="chat" className="flex flex-col gap-3 p-3">
				{/* Items are only ever appended, never reordered, so the index is a stable key. */}
				{items.map((item, i) => (
					<ItemView key={i} item={item} />
				))}
			</ConversationContent>
			<ConversationScrollButton />
		</Scroller>
	);
}
