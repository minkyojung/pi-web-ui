/**
 * The one setting the app keeps for itself, in a place the settings dialog can
 * write to.
 *
 * In a directory of the app's own, ~/.octave, rather than under pi's: what pi
 * keeps there — credentials, sessions, its settings — is pi's and stays where
 * pi's CLI expects it, and what Octave keeps for itself should not look like a
 * corner of pi's. The file does not exist until something is changed — an
 * absent file means the defaults, so a fresh install has nothing to read and
 * nothing to keep in sync.
 *
 * Read on every use rather than held: a mode changed in the dialog should
 * apply to the next session, not the next restart.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "./atomic.ts";
import { LOADOUT_SLOTS } from "./models.ts";
import { DEFAULT_MODE, MODE_IDS, type ToolModeId } from "./toolModes.ts";

export const APP_DIR = process.env.APP_DIR ?? join(homedir(), ".octave");
export const SETTINGS_PATH = join(APP_DIR, "settings.json");

export interface Settings {
	/** Which rung of the tool ladder a new session opens on. */
	toolMode: ToolModeId;
	/**
	 * The models the picker offers, in the order it offers them, as
	 * `provider/id`. Empty until somebody chooses, and read as the seed list
	 * meanwhile — see SEED_LOADOUT in models.ts.
	 */
	loadout: string[];
	/**
	 * Whether a note made here writes down when it was made. The file system's
	 * own answer does not survive a clone or a sync, and the note's does — see
	 * withCreated in vault.ts. Off for someone who would rather their notes
	 * carried nothing they did not write.
	 */
	created: boolean;
}

export const DEFAULTS: Settings = {
	toolMode: DEFAULT_MODE,
	loadout: [],
	created: true,
};

/**
 * Anything at all into settings. The file is hand-editable and the browser is
 * across a socket, so neither is trusted: every field is read on its own and
 * falls back on its own, and one bad line cannot take the rest down with it.
 */
export function coerce(raw: unknown): Settings {
	const o = (raw ?? {}) as Record<string, unknown>;
	return {
		toolMode: MODE_IDS.includes(o.toolMode as ToolModeId) ? (o.toolMode as ToolModeId) : DEFAULTS.toolMode,
		// Whatever of the list is a string survives; a model that has since gone
		// is dropped when the list is read against what pi offers, not here, so a
		// provider that is merely logged out keeps its place in the file.
		loadout: Array.isArray(o.loadout)
			? o.loadout.filter((key) => typeof key === "string").slice(0, LOADOUT_SLOTS)
			: [],
		created: typeof o.created === "boolean" ? o.created : DEFAULTS.created,
	};
}

export function readSettings(): Settings {
	if (!existsSync(SETTINGS_PATH)) return coerce({});
	try {
		return coerce(JSON.parse(readFileSync(SETTINGS_PATH, "utf8")));
	} catch {
		// Unreadable is the same as absent: a broken file costs the defaults, not
		// the session that was about to open.
		return coerce({});
	}
}

/** Writes what it read back, so the caller shows the same value the next session will use. */
export function writeSettings(next: unknown): Settings {
	const settings = coerce(next);
	writeAtomic(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
	return settings;
}
