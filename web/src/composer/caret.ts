/**
 * Where the caret is in the message box, as the lists read it (Composer.tsx):
 * the line up to the caret as text, and where that text starts in the
 * document — so an offset found in the text (mentionQuery's `from`) is a
 * position to replace from. A chip is one character there (CHIP_CHAR), as it
 * is one position in the document, so the two count alike.
 *
 * Over ProseMirror's state and nothing else: testable without a view.
 */
import type { EditorState } from "@tiptap/pm/state";

import { CHIP_CHAR } from "./text.ts";

/** The caret's line up to the caret, and the document position its first character is at. */
export function lineBefore(state: EditorState): { text: string; start: number } {
	const { $from } = state.selection;
	return { text: $from.parent.textBetween(0, $from.parentOffset, "\n", CHIP_CHAR), start: $from.start() };
}
