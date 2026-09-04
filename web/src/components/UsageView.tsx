import type { UsageMsg } from "../types";

/** Token spend and context pressure, in the same shapes the old client formatted. */
export function UsageView({ usage }: { usage: UsageMsg }) {
	const percent = usage.context?.percent;
	// Percent is 0-100 and often well under 1 early on; rounding to an integer would read as 0 or 1.
	const context = percent != null ? `context ${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%` : "context —";
	const title =
		`input ${usage.tokens.input} · output ${usage.tokens.output} · ` +
		`cache read ${usage.tokens.cacheRead} · cache write ${usage.tokens.cacheWrite}\n` +
		`messages ${usage.messages} · tool calls ${usage.toolCalls}` +
		(usage.context ? `\ncontext ${usage.context.tokens ?? "?"} / ${usage.context.window}` : "");

	return (
		<span id="usage" className="ml-auto flex items-center gap-1.5 tabular-nums text-muted-foreground" title={title}>
			{`$${usage.cost.toFixed(4)}`} ·{" "}
			{/* Compaction kicks in near the top of the window; warn before it surprises the user. */}
			<span className={percent != null && percent >= 70 ? "text-amber-600 dark:text-amber-500" : undefined}>
				{context}
			</span>
		</span>
	);
}
