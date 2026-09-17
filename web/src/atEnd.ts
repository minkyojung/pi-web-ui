import { createStore } from "./serverState";

/**
 * Whether the conversation is scrolled to its end, where the last run's result
 * is.
 *
 * The conversation knows it (use-stick-to-bottom works it out to decide whether
 * to follow new text) and the strip at the foot of the window needs it, and the
 * two are not in the same part of the tree — so it is put down here, the way
 * what is in front of the editor is (inFront.ts). True to begin with: a
 * conversation opens at its end.
 */
export const atEndStore = createStore<boolean>(true);
