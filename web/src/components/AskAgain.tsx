import { useSyncExternalStore } from "react";
import { PencilIcon } from "lucide-react";

import { askingAgainStore, configStore, restoredStore } from "../serverState";
import { Button } from "./ui/button";

/**
 * Ask this question again, differently.
 *
 * pi keeps every answer a question ever had, so a second way of asking is not
 * a correction that loses the first — it is a branch beside it, and the arrows
 * next to this button are the way back.
 *
 * Pressing it moves nothing. It copies the question into the box and remembers
 * where it came from; the session's leaf moves when the new question is
 * actually sent. Moving first would be simpler and is what pi's own navigation
 * does, but it takes the question and its answer off the screen at the moment
 * you might still change your mind — and with no sibling yet, no arrows exist
 * to bring them back.
 */
export function AskAgain({ entryId, text }: { entryId: string; text: string }) {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);

	return (
		<Button
			size="icon-xs"
			variant="ghost"
			title="Ask this again, differently"
			// pi will not move a leaf mid-reply: the reply is being written into
			// the branch that would be left behind.
			disabled={config?.isStreaming ?? false}
			className="opacity-0 transition-opacity group-hover/user:opacity-100 focus-visible:opacity-100"
			onClick={() => {
				askingAgainStore.set({ entryId, text });
				// Through the same door a cleared queue uses, which appends rather
				// than assigns: a half-written line in the box is not ours to throw
				// away just because something else wants to be in there.
				restoredStore.set(text);
			}}
		>
			<PencilIcon />
		</Button>
	);
}
