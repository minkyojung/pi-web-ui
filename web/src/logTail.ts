/**
 * Whether a view scrolled to its end should stay there when more arrives —
 * the rule a terminal's tail has: reading the end, the new lines are what
 * is wanted; scrolled up to read something earlier, they are not, and the
 * page must not jump. A little slack, since a line's height of rounding is
 * not a decision to scroll up.
 */
export const SLACK = 4;

export function stuckToEnd({ scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
	return scrollTop + clientHeight >= scrollHeight - SLACK;
}

/** A log the app's commands printed, under its folder (vault.ts RUNS_DIR): opened at its end, since the end is the news. */
export const isRunLog = (path: string): boolean => path.startsWith(".pi/runs/");
