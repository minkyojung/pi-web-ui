/**
 * How long a run took, in the shortest form that is still honest.
 *
 * A run that took a minute and a half is not usefully "90.4 seconds", and one
 * that took a moment is not usefully "0 seconds" — so the unit follows the
 * size, and the only place a decimal earns its place is under ten seconds,
 * where the difference between two and eight is the difference between a
 * question answered and a question thought about.
 */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 10_000) return `${Math.round(ms / 100) / 10}s`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** When it finished, on the reader's own clock. */
export function formatClock(at: number): string {
	return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Tokens, at the precision anyone actually reads them: three figures at most. */
export function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "";
	if (n < 1000) return `${Math.round(n)} tok`;
	const thousands = n / 1000;
	return `${thousands < 100 ? Math.round(thousands * 10) / 10 : Math.round(thousands)}k tok`;
}

/**
 * What it cost.
 *
 * Most runs cost fractions of a cent, where two decimal places round every one
 * of them to $0.00 and say nothing. So the small ones keep four places, and
 * only what is worth a cent is written like money.
 */
export function formatCost(dollars: number): string {
	if (!Number.isFinite(dollars) || dollars <= 0) return "";
	return dollars < 0.01 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(2)}`;
}

/**
 * A run's ending, when it is worth saying.
 *
 * `stop` is a model that finished its sentence and `toolUse` is one on its way
 * to a tool — neither is news. The rest are: an answer cut off at the token
 * limit reads exactly like a finished one, which is how you come to trust a
 * paragraph that was never written to its end.
 */
const ENDINGS: Record<string, string> = {
	length: "truncated",
	aborted: "stopped",
	error: "failed",
	deferred: "deferred",
};

export function stopNote(stopReason: string | undefined): string | null {
	return (stopReason && ENDINGS[stopReason]) ?? null;
}

/**
 * The line under a finished run.
 *
 * Empty when the run carried nothing worth saying, which is what a conversation
 * rebuilt from stored messages produces — there is no `agent_settled` in a
 * session file, so a resumed run has no end to date.
 */
export function turnParts({
	startedAt,
	endedAt,
	tokens,
	cost,
}: {
	startedAt?: number;
	endedAt?: number;
	tokens?: number;
	cost?: number;
}): string[] {
	const parts = [];
	if (typeof startedAt === "number" && typeof endedAt === "number") {
		const took = formatDuration(endedAt - startedAt);
		if (took) parts.push(took);
	}
	if (typeof endedAt === "number") parts.push(formatClock(endedAt));
	if (typeof tokens === "number") {
		const count = formatTokens(tokens);
		if (count) parts.push(count);
	}
	if (typeof cost === "number") {
		const spend = formatCost(cost);
		if (spend) parts.push(spend);
	}
	return parts;
}

/**
 * What the run above a `done` said.
 *
 * Read off the conversation when someone reaches for it, rather than carried on
 * the item. Carrying it meant every run in a session file arrived with a second
 * copy of its own answer inside the marker that ends it — seventeen per cent of
 * a snapshot in one recording, and close to double the text of a conversation
 * that is mostly prose, crossing the socket again on every reconnect to be read
 * by nobody who did not click.
 *
 * Tool output is left out: someone reaching for a copy button wants the answer,
 * not the work that produced it.
 */
export function answerAbove(items: { kind: string; text?: string }[], index: number): string {
	const said = [];
	for (let i = index - 1; i >= 0; i--) {
		if (items[i].kind === "done") break;
		if (items[i].kind === "assistant" && items[i].text) said.unshift(items[i].text);
	}
	return said.join("\n\n");
}
