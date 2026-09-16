/**
 * What to make of a pass over the model list, once it has run.
 *
 * pi decides which models are usable by reading each provider's credential
 * and checking it. A provider whose credential cannot be read at that moment
 * is left out of the list without a word — and the moment can be a bad one
 * for a reason that has nothing to do with the credential: the file every
 * provider's credential lives in is rewritten whole whenever an OAuth token
 * is renewed, and a pass that reads it mid-write sees nothing there. pi's own
 * CLI is not troubled, because it runs the pass again every time the model
 * picker is opened. This server lives for days and ran it once.
 *
 * So a pass is judged by what it took away. A provider offered a moment ago
 * and not now, with nobody having signed out, is most likely that bad moment,
 * and worth one more look. Shared at the repo root like toolModes.ts, so the
 * server's judgement and the tests of it are one thing.
 */

/**
 * The model pi puts a session on when there is none: a stand-in named
 * unknown/unknown, kept so the session has something to be on, and read by
 * pi's own CLI as "no model" (its isUnknownModel). Read the same way here, so
 * a first run's picker does not show it as a choice.
 */
export function isUnknownModel(model: { provider: string; id: string } | undefined): boolean {
	return !!model && model.provider === "unknown" && model.id === "unknown";
}

/** The providers a list of `provider/model` keys draws on, sorted. */
export function providersOf(models: readonly string[]): string[] {
	return [...new Set(models.map((key) => key.slice(0, key.indexOf("/"))))].sort();
}

/** The providers `before` offered that `after` does not. */
export function lostProviders(before: readonly string[], after: readonly string[]): string[] {
	const now = new Set(providersOf(after));
	return providersOf(before).filter((provider) => !now.has(provider));
}

/**
 * What to tell the tabs about the list, or nothing when there is nothing to
 * say. pi's own report of trouble comes first; then a list with nothing on
 * it, which is what a first run sees and what pi's CLI answers with its
 * login dialog; a provider gone missing is said in the app's words, since pi
 * says nothing about that.
 */
export function modelsNotice(lost: readonly string[], error: string | undefined, offered: readonly string[]): string | undefined {
	if (error) return error;
	if (!offered.length) return "No provider is signed in. Run `pi` in a terminal and sign in with /login.";
	if (lost.length) return `${lost.join(", ")}: not offered just now — the credentials could not be read. Looking again.`;
	return undefined;
}

/**
 * pi's thinking levels, weakest first.
 *
 * Written out again rather than imported. pi's copy lives in
 * @earendil-works/pi-ai, which sits under pi-coding-agent's own node_modules
 * and is not re-exported, so importing it would mean depending on it directly
 * — a second copy, free to drift from the one the session actually runs on.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** As much of pi's Model as a level needs. */
interface Reasoner {
	reasoning: boolean;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}

/**
 * Which levels a model offers — including models the session is not on.
 *
 * pi answers this for the current model only (getAvailableThinkingLevels), and
 * the picker names a level beside every model it lists, so its rule is
 * followed here: a model that does not reason has the one level; otherwise a
 * level is offered unless the map says null against it, except xhigh and max,
 * which are offered only where the map names them. An absent key there means
 * the provider has no value to send for that level, not that a default will do.
 */
export function supportedLevels(model: Reasoner): ThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}

/**
 * The level a model will actually be on when asked for one it does not offer.
 *
 * Harder first, then easier, which is pi's order in clampThinkingLevel: asking
 * for more thought than a model has should not quietly buy less. Shown in the
 * picker beside a model before it is chosen, so it has to be what pi will do
 * rather than what was wished for.
 */
export function clampLevel(levels: readonly ThinkingLevel[], wanted: string): ThinkingLevel {
	if (levels.includes(wanted as ThinkingLevel)) return wanted as ThinkingLevel;
	const from = THINKING_LEVELS.indexOf(wanted as ThinkingLevel);
	if (from === -1) return levels[0] ?? "off";
	for (let i = from + 1; i < THINKING_LEVELS.length; i++) {
		if (levels.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
	}
	for (let i = from - 1; i >= 0; i--) {
		if (levels.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
	}
	return levels[0] ?? "off";
}

/**
 * How many models the loadout holds.
 *
 * Held to a number rather than left open because the list is the thing the
 * picker opens on: it has to be read at a glance and reached by a digit, and
 * both stop being true somewhere around here. The loadout screen draws this
 * many places, and settings keeps no more.
 */
export const LOADOUT_SLOTS = 5;

/**
 * What the picker offers before anyone has said what it should offer: the
 * newest GPT models, newest first.
 *
 * A seed rather than a default — read only while the loadout in settings is
 * empty, so editing it here still reaches anyone who has never chosen. What it
 * names and pi does not offer is passed over: a model the credentials do not
 * reach, or one renamed since, leaves a shorter list rather than a dead row.
 */
export const SEED_LOADOUT: readonly string[] = [
	"openai/gpt-6-astra",
	"openai/gpt-5.6-sol",
	"openai/gpt-5.6-luna",
	"openai/gpt-5.6-terra",
	"openai/gpt-5.5",
];

/**
 * The models the picker lists: those chosen, in the order chosen, and the one
 * the session is on.
 *
 * The current model belongs on the list whether or not anybody put it there.
 * pi opens on the model it was left on, and the CLI can leave it on one this
 * app never offered; without it the list would show nothing as chosen and the
 * first keystroke would silently move the session off it.
 */
export function loadoutOf(
	chosen: readonly string[],
	available: readonly string[],
	current: string | null,
): string[] {
	const offered = new Set(available);
	const keys = (chosen.length ? chosen : SEED_LOADOUT).filter((key) => offered.has(key));
	if (current && !keys.includes(current)) keys.push(current);
	return keys;
}
