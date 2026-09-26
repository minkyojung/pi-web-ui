/**
 * What a file's chip does when it is pressed, wherever it is — in the message
 * box or in a message sent (ChipLayer.tsx): a picture given to the box is
 * looked at, large, over the window; anything else is put in front as the
 * list of notes would put it — a note, a PDF, a file read as text, or one
 * that is not text, whose tab offers the Finder (Code.tsx).
 */
import { chipAction } from "./composer/chip";
import { requestOpen } from "./openRequest";
import { createStore } from "./serverState";

/** The picture being looked at, large, if one is. */
export const pictureStore = createStore<string | null>(null);

export function openChip(path: string): void {
	if (chipAction(path) === "picture") pictureStore.set(path);
	else requestOpen(path);
}
