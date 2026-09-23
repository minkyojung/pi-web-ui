/**
 * Where a task stands, as one mark: a circle, drawn once, and told how full
 * and what colour to be. The list of the plan (TaskList.tsx) and the list of
 * results at the foot of the window (TaskResults.tsx) both draw it, so a task
 * looks the same wherever it is met.
 *
 * The family is Linear's, because it is the one people already read: an empty
 * ring is to do — which of them is next is the first from the top, not a mark
 * — a dashed ring waits on something, a ring filling up is under
 * way — three quarters for in review, which is nearly there — and a filled
 * disc is over, a tick for done and a cross for set aside. Colour is on the
 * disc alone and says how far along, in the window's own colours: the
 * warning under way, the success in review, the accent for done (the
 * status-* names are aliases of those, styles.css); to do and set aside are
 * the page's grey. Running keeps the spinner: motion says it better than a fraction.
 */
import { cn } from "cn";

import type { Standing } from "../taskTree.ts";
import { Spinner } from "./ui/spinner";

/** Arc of a circle of radius r at the centre, from twelve o'clock clockwise through `fraction` of the way round. */
function pie(fraction: number, r: number): string {
	const a = 2 * Math.PI * fraction;
	const x = 8 + r * Math.sin(a);
	const y = 8 - r * Math.cos(a);
	return `M8 8 L8 ${8 - r} A${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
}

export function TaskGlyph({ standing, blocked = false, className }: { standing: Standing; blocked?: boolean; className?: string }) {
	const size = cn("size-4 shrink-0", className);
	if (standing === "running") return <Spinner className={cn(size, "text-status-progress")} aria-label="running" />;
	const ring = { cx: 8, cy: 8, r: 6.25, fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;
	switch (standing) {
		case "todo":
			// Waiting on another task is a ring that is not yet whole.
			if (blocked) return <svg viewBox="0 0 16 16" className={cn(size, "text-muted-foreground/60")} role="img" aria-label="waiting on another task"><circle {...ring} strokeDasharray="2.6 2.3" strokeLinecap="round" /></svg>;
			return <svg viewBox="0 0 16 16" className={cn(size, "text-muted-foreground/60")} role="img" aria-label="to do"><circle {...ring} /></svg>;
		case "review":
			return (
				<svg viewBox="0 0 16 16" className={cn(size, "text-status-review")} role="img" aria-label="in review">
					<circle {...ring} />
					<path d={pie(0.75, 4)} fill="currentColor" />
				</svg>
			);
		case "done":
			return (
				<svg viewBox="0 0 16 16" className={cn(size, "text-status-done")} role="img" aria-label="done">
					<circle cx={8} cy={8} r={7} fill="currentColor" />
					<path d="M4.75 8.25 L7 10.5 L11.25 5.75" fill="none" stroke="var(--background)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			);
		case "cancelled":
			return (
				<svg viewBox="0 0 16 16" className={cn(size, "text-muted-foreground/40")} role="img" aria-label="set aside">
					<circle cx={8} cy={8} r={7} fill="currentColor" />
					<path d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5" fill="none" stroke="var(--background)" strokeWidth={1.75} strokeLinecap="round" />
				</svg>
			);
	}
}
