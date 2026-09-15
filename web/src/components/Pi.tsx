import { useSyncExternalStore } from "react";

import { getItems, subscribe } from "../store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { RawView } from "./RawView";

/**
 * pi's body: the conversation, and the box to write in.
 *
 * Its name is not here. That is in the row above the card, which the window
 * draws (App.tsx), because the row belongs to the column rather than to pi —
 * the same rule the other two keep, a row on the frame saying which of the
 * thing below it you are looking at.
 */
export function Pi({ note, raw }: { note: string | null; raw: boolean }) {
	const items = useSyncExternalStore(subscribe, getItems);
	return (
		<>
			{/* The two views used to be swapped by a body.raw class, which has no
			    home in a utility stylesheet — and only one was ever read. */}
			{raw ? <RawView /> : <Conversation items={items} />}
			<Composer note={note} />
		</>
	);
}
