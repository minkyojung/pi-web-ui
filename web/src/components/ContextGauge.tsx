import { useSyncExternalStore } from "react";

import { describeContext, type Tone } from "../contextGauge";
import { usageStore } from "../serverState";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const R = 8;
const C = 2 * Math.PI * R;

const TONE: Record<Tone, string> = {
	unknown: "text-muted-foreground/60",
	ok: "text-muted-foreground",
	warn: "text-amber-500",
	danger: "text-red-500",
};

/**
 * How full the context window is, as a ring next to the send button. The
 * server sends usage after every completed message, so this moves at the end
 * of each turn rather than during it. Thresholds and wording live in
 * contextGauge.ts, where they are tested.
 */
export function ContextGauge() {
	const usage = useSyncExternalStore(usageStore.subscribe, usageStore.get);
	const { fraction, tone, label } = describeContext(usage?.context);
	const percent = usage?.context?.percent ?? null;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					id="context-gauge"
					className={`inline-flex size-7 cursor-default items-center justify-center ${TONE[tone]}`}
					data-percent={percent ?? ""}
					aria-label={label}
					role="img"
				>
					<svg viewBox="0 0 20 20" className="size-5 -rotate-90">
						<circle cx="10" cy="10" r={R} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
						<circle
							cx="10"
							cy="10"
							r={R}
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							strokeLinecap="round"
							strokeDasharray={C}
							strokeDashoffset={C * (1 - fraction)}
							className="transition-[stroke-dashoffset] duration-500"
						/>
					</svg>
				</span>
			</TooltipTrigger>
			<TooltipContent side="top">{label}</TooltipContent>
		</Tooltip>
	);
}
