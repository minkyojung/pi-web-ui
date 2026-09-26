/**
 * A request to put a file in front, from somewhere that is not handed the
 * window's way of opening one: a file's chip, in the message box or in a
 * message sent (chipActions.ts). The window reads it, opens the file as the
 * list of notes would, and clears it — as settingsOpen.ts does for settings.
 */
import { createStore } from "./serverState";

export const openRequestStore = createStore<string | null>(null);

export const requestOpen = (path: string) => openRequestStore.set(path);
