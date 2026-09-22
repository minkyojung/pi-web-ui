/**
 * What the page keeps about the window rather than about a workspace: the
 * theme, the widths of the columns, how a note is counted.
 *
 * The page's own storage is by the address of the server it is on, which
 * is one for each workspace — so kept there, a theme chosen in one
 * workspace was not the theme in the next, and the start page, on an
 * address of the shell's own, had no theme at all. There is one window,
 * and what is about it is kept once, here, beside the shell's other
 * settings, and handed to every page as it loads (preload.cjs `prefs`).
 *
 * Strings in, strings out, as the page's storage has it, so what the page
 * kept there moves without being read. Pure: settings in, settings out.
 */

/** Long enough for a saved layout; nothing about a window is a document. */
const LONGEST = 4000;

const isPref = (key, value) => typeof key === "string" && key.length > 0 && key.length <= 100 && typeof value === "string" && value.length <= LONGEST;

/** The prefs the settings hold, with anything that is not a string under a string left out. */
export function prefsOf(settings) {
	const stored = settings?.prefs;
	if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
	return Object.fromEntries(Object.entries(stored).filter(([key, value]) => isPref(key, value)));
}

/** `prefs` with `key` set to `value`, or without it for null; the same object for anything that is not a pref. */
export function withPref(prefs, key, value) {
	if (value === null) {
		if (!(key in prefs)) return prefs;
		const { [key]: _gone, ...rest } = prefs;
		return rest;
	}
	if (!isPref(key, value)) return prefs;
	return prefs[key] === value ? prefs : { ...prefs, [key]: value };
}
