/**
 * The handful of numbers the app runs on, in one place the settings dialog can
 * write to.
 *
 * Beside subscriptions.json rather than under the agent's own directory: these
 * are settings for this app, and the reader directory is the only one it has.
 * The file does not exist until something is changed — an absent file means the
 * defaults, so a fresh install has nothing to read and nothing to keep in sync.
 *
 * Read on every use rather than held. The pass that fetches feeds and the run
 * that writes a briefing are both long-lived, and a number changed in the
 * dialog should take effect the next time it is asked for, not the next time
 * the process is restarted.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { READER_DIR } from "./reader/store.ts";
import { DEFAULT_MODE, MODE_IDS, type ToolModeId } from "./toolModes.ts";

export const SETTINGS_PATH = join(READER_DIR, "settings.json");

export interface Settings {
	/** How far back into a feed to take entries. Some feeds hand over their whole past. */
	feedDays: number;
	/** The window a briefing covers. */
	briefHours: number;
	/** How much of each piece the briefing model is given. */
	briefChars: number;
	/** Which rung of the tool ladder a new session opens on. */
	toolMode: ToolModeId;
}

export const DEFAULTS: Settings = {
	feedDays: 7,
	briefHours: 24,
	// 400자에서는 모델이 짐작하다 틀렸다 — briefCli.ts가 쓰던 값 그대로다.
	briefChars: 1000,
	toolMode: DEFAULT_MODE,
};

/**
 * What each number may be. A bound is not a guess about taste; it is the range
 * outside which the thing stops working — a feed window of zero days collects
 * nothing, and eight thousand characters a piece is more than the model will
 * read of two hundred of them.
 */
export const LIMITS = {
	feedDays: [1, 90],
	briefHours: [1, 720],
	briefChars: [200, 8000],
} as const satisfies Record<string, readonly [number, number]>;

type NumericKey = keyof typeof LIMITS;

/** Clamped, not refused. A number outside the range comes back as the nearest one it may be, which the dialog then shows — an edit that quietly did nothing would be worse. */
function num(value: unknown, key: NumericKey): number {
	const n = Math.round(Number(value));
	if (!Number.isFinite(n)) return DEFAULTS[key];
	const [lo, hi] = LIMITS[key];
	return Math.min(hi, Math.max(lo, n));
}

/**
 * Anything at all into settings. The file is hand-editable and the browser is
 * across a socket, so neither is trusted: every field is read on its own and
 * falls back on its own, and one bad line cannot take the rest down with it.
 */
export function coerce(raw: unknown): Settings {
	const o = (raw ?? {}) as Record<string, unknown>;
	return {
		feedDays: num(o.feedDays, "feedDays"),
		briefHours: num(o.briefHours, "briefHours"),
		briefChars: num(o.briefChars, "briefChars"),
		toolMode: MODE_IDS.includes(o.toolMode as ToolModeId) ? (o.toolMode as ToolModeId) : DEFAULTS.toolMode,
	};
}

export function readSettings(): Settings {
	if (!existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
	try {
		return coerce(JSON.parse(readFileSync(SETTINGS_PATH, "utf8")));
	} catch {
		// Unreadable is the same as absent. This is asked for in the middle of a
		// feed pass; a broken file should cost the defaults, not the pass.
		return { ...DEFAULTS };
	}
}

/** Writes what it read back, so the caller shows the same numbers the next pass will use. */
export function writeSettings(next: unknown): Settings {
	const settings = coerce(next);
	mkdirSync(READER_DIR, { recursive: true });
	writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
	return settings;
}
