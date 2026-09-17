import { useSyncExternalStore } from "react";

import { getItems, subscribe } from "../store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { PanelHeader } from "./PanelHeader";
import { RawView } from "./RawView";

/**
 * pi, whole: the session's name, the conversation, and the box to write in.
 *
 * The name stays in here rather than going up to the row over the columns.
 * That row is the note tabs' — it runs across pi as well as the note, since
 * the tabs want more width than the note alone has — and which session is
 * open is pi's own business, not something true of the pair of them.
 */
export function Pi({ note, raw }: { note: string | null; raw: boolean }) {
	const items = useSyncExternalStore(subscribe, getItems);
	return (
		<>
			<PanelHeader />
			{/* The two views used to be swapped by a body.raw class, which has no
			    home in a utility stylesheet — and only one was ever read. */}
			{raw ? <RawView /> : <Conversation items={items} />}
			<Composer note={note} />
		</>
	);
}
