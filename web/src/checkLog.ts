/**
 * Where a task's check left what it printed: `.pi/runs/<task>/<name>.log`,
 * the name made a file's the way spec.ts writes it. The results list opens
 * it from the tick or the cross, in a tab (Code.tsx) — the commit says how
 * the check ended, and this says why.
 */
export const checkLogPath = (task: string, name: string): string => `.pi/runs/${task}/${name.replace(/[^\w.-]+/g, "_")}.log`;
