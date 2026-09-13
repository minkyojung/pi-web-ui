/**
 * Where a change came from. A change the server made — the file as it is
 * on disk, or what pi wrote — is not the person's typing: it is not saved
 * back, not undone by ⌘Z, and not tidied by the editor as typing is.
 */
import { Annotation, Transaction } from "@codemirror/state";

/** Marks a change the server made, so it is not taken for typing and saved back. */
export const fromServer = Annotation.define<boolean>();

/**
 * On every change the server makes: not typing, and not undoable. ⌘Z undoes
 * what the person typed; what pi or another editor wrote is not theirs to
 * take back that way, and an undo that reached it would then be saved as a
 * change of theirs.
 */
export const serverChange = [fromServer.of(true), Transaction.addToHistory.of(false)];
