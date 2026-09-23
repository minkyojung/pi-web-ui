/**
 * Light, dark, either Octave, or whatever the system says.
 *
 * Kept with the window rather than in settings.json with the rest (prefs.ts).
 * A theme is about the screen it is being read on, not about the work — the
 * same reader on a laptop at night and a desk in daylight wants two answers,
 * and a setting on the server can only hold one.
 *
 * The choice and the answer are two different things. The choice is one of the
 * five below; the answer is one of the four that name a theme, since only
 * system has anything left to resolve — to light or dark, by what the screen
 * says. System resolves to the neutral pair and not to Octave: it answers
 * how bright the room is, which is not an answer to which palette was wanted.
 * The answer is what goes on the element as data-theme. index.html works it out
 * again, inline, before the first paint — keep the two in step.
 */
import { prefs } from "./prefs.ts";

export type Theme = "system" | "light" | "dark" | "octave-light" | "octave-dark";

const KEY = "theme";
const THEMES: Theme[] = ["system", "light", "dark", "octave-light", "octave-dark"];
const dark = () => matchMedia("(prefers-color-scheme: dark)");

export function readTheme(): Theme {
	const stored = prefs.get(KEY) as Theme | null;
	return stored && THEMES.includes(stored) ? stored : "system";
}

export function applyTheme(theme: Theme): void {
	const resolved = theme === "system" ? (dark().matches ? "dark" : "light") : theme;
	document.documentElement.dataset.theme = resolved;
}

export function setTheme(theme: Theme): void {
	prefs.set(KEY, theme);
	applyTheme(theme);
}

/**
 * Follow the system while that is what was asked for. Installed once, for the
 * life of the page: the system flips at sunset without anything being clicked,
 * and a window left open should turn with it.
 */
export function watchSystem(): void {
	dark().addEventListener("change", () => {
		if (readTheme() === "system") applyTheme("system");
	});
}
