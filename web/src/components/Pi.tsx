import { useSyncExternalStore } from "react";

import { getItems, subscribe } from "../store";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { PanelHeader } from "./PanelHeader";
import { RawView } from "./RawView";

/**
 * pi, whole: the session's name, the conversation, and the box to write in.
 * One piece, so that where it sits — a column beside the note today — is the
 * host's business and not its own. Nothing here knows about columns.
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
