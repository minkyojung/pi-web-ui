/**
 * Light, dark, or whatever the system says.
 *
 * Kept in this browser rather than in settings.json with the rest. A theme is
 * about the screen it is being read on, not about the library — the same
 * reader on a laptop at night and a desk in daylight wants two answers, and a
 * setting on the server can only hold one.
 *
 * The choice and the answer are two different things. The choice is one of the
 * three below; the answer is only ever light or dark, and that is what goes on
 * the element as data-theme. index.html works it out again, inline, before the
 * first paint — keep the two in step.
 */
export type Theme = "system" | "light" | "dark";

const KEY = "theme";
const THEMES: Theme[] = ["system", "light", "dark"];
const dark = () => matchMedia("(prefers-color-scheme: dark)");

/** Storage throws in a window opened with cookies blocked; the default is not worth a crash. */
export function readTheme(): Theme {
	try {
		const stored = localStorage.getItem(KEY) as Theme | null;
		return stored && THEMES.includes(stored) ? stored : "system";
	} catch {
		return "system";
	}
}

export function applyTheme(theme: Theme): void {
	const resolved = theme === "system" ? (dark().matches ? "dark" : "light") : theme;
	document.documentElement.dataset.theme = resolved;
}

export function setTheme(theme: Theme): void {
	try {
		localStorage.setItem(KEY, theme);
	} catch {
		// Unwritable storage costs the choice its memory, not this window its theme.
	}
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
