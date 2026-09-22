/**
 * What this page keeps about the window rather than about the workspace:
 * the theme, the widths of the columns, how a note is counted.
 *
 * In the shell, when there is one — one window, one set of prefs, whatever
 * workspace is in front and on the start page too (electron/prefs.js). The
 * shell hands them over as the page loads, before anything of it runs, so
 * they are read as the browser's own storage is: at once. A page with no
 * shell — a browser tab, the vite dev server — keeps them in that storage,
 * as it always did.
 */
import type { LayoutStorage } from "react-resizable-panels";

export interface Prefs {
	get(key: string): string | null;
	set(key: string, value: string | null): void;
}

const shell = (): Prefs | null => (typeof window === "undefined" ? null : (window as unknown as { pi?: { prefs?: Prefs } }).pi?.prefs ?? null);

/** Storage throws in a window opened with cookies blocked; a pref is not worth a crash. */
const browser: Prefs = {
	get(key) {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	set(key, value) {
		try {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch {
			// A window that will not keep it forgets, which is all that is lost.
		}
	},
};

export const prefs: Prefs = shell() ?? browser;

/** The same, in the shape the columns' layout is saved through. */
export const layoutStorage: LayoutStorage = { getItem: (key) => prefs.get(key), setItem: (key, value) => prefs.set(key, value) };
