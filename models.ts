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
 * say. pi's own report of trouble comes first; a provider gone missing is
 * said in the app's words, since pi says nothing about that.
 */
export function modelsNotice(lost: readonly string[], error: string | undefined): string | undefined {
	if (error) return error;
	if (lost.length) return `${lost.join(", ")}: not offered just now — the credentials could not be read. Looking again.`;
	return undefined;
}
