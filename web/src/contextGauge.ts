/**
 * What the context gauge shows for a given usage. Pure, so the thresholds and
 * the wording can be tested without a browser.
 */
import type { UsageMsg } from "./types";

export type Tone = "unknown" | "ok" | "warn" | "danger";

export interface GaugeState {
	/** 0..1 of the ring to fill. */
	fraction: number;
	tone: Tone;
	label: string;
}

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * Amber from 70% — compaction starts near the top of the window and this is
 * the warning before it — and red from 90%. Right after a compaction pi has no
 * estimate, so the ring goes empty and says so rather than pretending.
 */
export function describeContext(context: UsageMsg["context"] | undefined): GaugeState {
	const percent = context?.percent ?? null;
	if (!context || percent === null) return { fraction: 0, tone: "unknown", label: "Context usage unknown" };
	const shown = percent < 10 ? percent.toFixed(1) : String(Math.round(percent));
	return {
		fraction: Math.min(Math.max(percent, 0), 100) / 100,
		tone: percent >= 90 ? "danger" : percent >= 70 ? "warn" : "ok",
		label: `Context ${shown}% · ${compact(context.tokens ?? 0)} / ${compact(context.window)}`,
	};
}
