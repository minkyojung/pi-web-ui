import { createStore } from "./serverState";

/**
 * The file the Changes page is to bring into view, when it is opened from
 * that file's line in the list at the foot of the window. Beside the
 * address rather than in it: the page is one tab for every file, and an
 * address with the file in it would make a tab a file. The page clears it
 * once it has scrolled there, so coming back to the tab later does not jump.
 */
export const changesTargetStore = createStore<string | null>(null);
