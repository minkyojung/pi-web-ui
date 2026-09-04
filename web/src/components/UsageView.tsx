import type { UsageMsg } from "../types";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Token spend and context pressure. */
export function UsageView({ usage }: { usage: UsageMsg }) {
	const percent = usage.context?.percent;
	// Percent is 0-100 and often well under 1 early on; rounding to an integer would read as 0 or 1.
	const context = percent != null ? `context ${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%` : "context —";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span id="usage" className="ml-auto cursor-default tabular-nums text-muted-foreground">
					{`$${usage.cost.toFixed(4)}`} ·{" "}
					{/* Compaction kicks in near the top of the window; warn before it surprises the user. */}
					<span className={percent != null && percent >= 70 ? "text-amber-600 dark:text-amber-500" : undefined}>
						{context}
					</span>
				</span>
			</TooltipTrigger>
			{/* These used to be \n inside a title attribute, which rendered as one line. */}
			<TooltipContent side="bottom" align="end" className="tabular-nums">
				<div>
					input {usage.tokens.input} · output {usage.tokens.output}
				</div>
				<div>
					cache read {usage.tokens.cacheRead} · cache write {usage.tokens.cacheWrite}
				</div>
				<div>
					messages {usage.messages} · tool calls {usage.toolCalls}
				</div>
				{usage.context && (
					<div>
						context {usage.context.tokens ?? "?"} / {usage.context.window}
					</div>
				)}
			</TooltipContent>
		</Tooltip>
	);
}
