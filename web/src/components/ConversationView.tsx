import { useCallback, useRef } from "react";

import { answerAbove } from "../turn";
import type { Item } from "../types";
import { Conversation as Scroller, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";
import { ItemView } from "./Item";
import { RunAnswer } from "./TurnFooter";

/**
 * The scroll container. use-stick-to-bottom replaces the hand-rolled follow
 * logic that had to record the user's scrolls to avoid measuring after new
 * content had already changed scrollHeight; it watches the content instead,
 * and brings a jump-to-bottom button with it.
 *
 * Its own file, not a second export of Conversation.tsx: the gallery mounts
 * this list and must not open a socket, and PromptCard — which answers over
 * one — would come with the module whether or not the export was used.
 */
export function ConversationView({ items, children }: { items: Item[]; children?: React.ReactNode }) {
	// Through a ref, so the lookup a footer holds does not change identity when
	// the list does — a new one every render would re-render every finished run
	// on every delta, which memoizing the rows exists to avoid.
	const latest = useRef(items);
	latest.current = items;
	const answerAt = useCallback((index: number) => answerAbove(latest.current, index), []);

	return (
		<RunAnswer value={answerAt}>
			<Scroller className="relative flex-1 overflow-y-auto">
				<ConversationContent id="chat" className="flex flex-col gap-3 p-3">
					{/* Items are only ever appended, never reordered, so the index is a stable key. */}
					{items.map((item, i) => (
						<ItemView key={i} item={item} index={i} />
					))}
					{children}
				</ConversationContent>
				<ConversationScrollButton />
			</Scroller>
		</RunAnswer>
	);
}
