import { useCallback, useEffect, useRef } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

import { atEndStore } from "../atEnd";
import { rowsOf } from "../runSummary";
import { answerAbove, wroteNotesAbove } from "../turn";
import type { Item } from "../types";
import { ActivityGroup } from "./ActivityGroup";
import { Conversation as Scroller, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";
import { ItemView } from "./Item";
import { RunAnswer, RunWrote } from "./TurnFooter";

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
/**
 * Says whether the conversation is at its end, for what is not inside it — the
 * strip's unread mark, which is read only once the run it stands for has been
 * on screen (atEnd.ts, resultSeen in working.ts).
 */
function AtEnd() {
	const { isAtBottom } = useStickToBottomContext();
	useEffect(() => atEndStore.set(isAtBottom), [isAtBottom]);
	return null;
}

export function ConversationView({ items, children }: { items: Item[]; children?: React.ReactNode }) {
	// Through a ref, so the lookup a footer holds does not change identity when
	// the list does — a new one every render would re-render every finished run
	// on every delta, which memoizing the rows exists to avoid.
	const latest = useRef(items);
	latest.current = items;
	const answerAt = useCallback((index: number) => answerAbove(latest.current, index), []);
	const wroteAt = useCallback((index: number) => wroteNotesAbove(latest.current, index), []);

	return (
		<RunAnswer value={answerAt}>
		<RunWrote value={wroteAt}>
			<Scroller className="no-scrollbar relative flex-1 overflow-y-auto">
				<ConversationContent id="chat" scrollClassName="edge-top" className="flex flex-col gap-3 p-3">
					{/* Items are only ever appended, never reordered, so the index of a row's
					    first item is a stable key, whether the row holds one item or many. */}
					{rowsOf(items).map((row) =>
						row.kind === "group" ? (
							<ActivityGroup key={row.index} items={row.items} index={row.index} />
						) : (
							<ItemView key={row.index} item={items[row.index]} index={row.index} />
						),
					)}
					{children}
				</ConversationContent>
				<ConversationScrollButton />
				<AtEnd />
			</Scroller>
		</RunWrote>
		</RunAnswer>
	);
}
