/**
 * What fills the context window, from the sizes the server reports.
 *
 * pi only knows the total — the model's own count after each response. The
 * fixed parts (system prompt, tool definitions, skills, memory files) are
 * estimated the way pi itself estimates: four characters per token. Messages
 * are whatever is left, which is the only part that grows as a conversation
 * does, and which can come out negative right after a compaction when the
 * total drops below the estimate of the fixed parts — so it is clamped.
 */
import type { ContextSourcesMsg, UsageMsg } from "./types";

export interface Row {
	label: string;
	tokens: number;
	percent: number;
	/** True for the parts that are estimated rather than counted. */
	estimated: boolean;
}

export interface Breakdown {
	used: number;
	window: number;
	percent: number;
	free: number;
	rows: Row[];
}

export const tokensOf = (chars: number) => Math.round(chars / 4);

export function breakdown(context: UsageMsg["context"] | undefined, sources: ContextSourcesMsg | null): Breakdown | null {
	if (!context || context.percent === null) return null;
	const window = context.window;
	const used = context.tokens ?? 0;
	const pct = (tokens: number) => (window > 0 ? (tokens / window) * 100 : 0);

	const fixed: Row[] = [];
	if (sources) {
		const activeTools = sources.tools.filter((t) => t.active);
		fixed.push(
			{ label: "System prompt", tokens: tokensOf(sources.systemPromptChars), percent: 0, estimated: true },
			{
				label: `Tools (${activeTools.length} active)`,
				tokens: tokensOf(activeTools.reduce((n, t) => n + t.chars, 0)),
				percent: 0,
				estimated: true,
			},
			{ label: `Skills (${sources.skills})`, tokens: 0, percent: 0, estimated: true },
			{
				label: `Memory files (${sources.memoryFiles.count})`,
				tokens: tokensOf(sources.memoryFiles.chars),
				percent: 0,
				estimated: true,
			},
		);
	}
	const fixedTotal = fixed.reduce((n, r) => n + r.tokens, 0);
	const messages = Math.max(0, used - fixedTotal);

	const rows: Row[] = [{ label: "Messages", tokens: messages, percent: 0, estimated: false }, ...fixed].map((r) => ({
		...r,
		percent: pct(r.tokens),
	}));

	return { used, window, percent: context.percent, free: Math.max(0, 100 - context.percent), rows };
}

/** 33400 → "33.4k", 272000 → "272k", 512 → "512". */
export function compact(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
