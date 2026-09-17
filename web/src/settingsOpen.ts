/**
 * A request to open settings on a section, from somewhere that is not the
 * settings button: the model picker's last item, or the app itself on a first
 * run with nobody signed in. Settings reads it, opens, and clears it.
 */
import { createStore } from "./serverState";

export const settingsOpenStore = createStore<string | null>(null);

export const openSettings = (section: string) => settingsOpenStore.set(section);
