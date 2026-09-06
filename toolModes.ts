/**
 * Tool modes: named rungs on a capability ladder, so the common case is one
 * click instead of eight checkboxes.
 *
 * Codex, Claude Code and Grok all expose a single risk ladder (read-only →
 * local edits → shell), but theirs are *approval* modes: every tool stays
 * callable and the mode decides when the agent must ask. We have no approval
 * layer, so ours is a *capability* ladder — a mode simply is a set of active
 * tools. Turning bash off is a stronger read-only than any prompt, and it needs
 * no new protocol: `set_tools` already exists.
 *
 * The ladder tools are pi's own eight built-ins (core/tools/index.js). Anything
 * else in the registry is an extension tool; it sits outside the ladder and
 * stays on in every mode, because `ask_user` is what makes read-only planning
 * conversational in the first place.
 *
 * At the repo root, like conversation.js, because the server picks the mode a
 * new session opens on and the browser names the one it is in. One ladder, not
 * two that can drift.
 */

export type ToolModeId = "plan" | "coding" | "full";

/**
 * Each rung adds one capability to the one below it. Strict supersets, so the
 * ladder reads as "unlock one more thing" and a mode's grants are just the
 * rungs at or below it.
 *
 * Full access is the top because it is every tool pi has. There is no rung
 * above it to add: with no approval layer there is nothing left to bypass.
 */
const RUNGS: { id: ToolModeId; name: string; tools: string[]; grant: string }[] = [
	{ id: "plan", name: "Plan", tools: ["read", "grep", "find", "ls"], grant: "Read, search and list files" },
	{ id: "coding", name: "Coding", tools: ["edit", "write"], grant: "Edit and create files" },
	{ id: "full", name: "Full access", tools: ["bash", "powershell"], grant: "Run shell commands" },
];

export const MODE_IDS = RUNGS.map((r) => r.id);

/**
 * What a new session opens on. pi starts one on read, bash, edit and write and
 * does not remember a change to that — tool activation is session-scoped there,
 * and there is no `persist` on setActiveToolsByName the way there is on
 * setModel. So the mode is chosen here, the same one every time, rather than
 * accumulated somewhere.
 *
 * Full access because it is pi's own default plus the search tools: everything
 * that worked before still works, and the agent stops shelling out to grep.
 * Starting a rung lower would take the shell away from someone who had it.
 */
export const DEFAULT_MODE: ToolModeId = "full";

const LADDER_TOOLS = new Set(RUNGS.flatMap((r) => r.tools));

/** A tool pi did not build in — an extension's. Outside the ladder, always on. */
export const isExtensionTool = (name: string) => !LADDER_TOOLS.has(name);

export interface ModeDescription {
	id: ToolModeId;
	name: string;
	/** What this mode lets the agent do. */
	can: string[];
	/** What it still cannot do — the reason to pick a lower rung. */
	cannot: string[];
	/** Ladder tools it turns on, in ladder order. */
	tools: string[];
}

export function describeMode(id: ToolModeId): ModeDescription {
	const at = RUNGS.findIndex((r) => r.id === id);
	if (at < 0) throw new Error(`Unknown tool mode: ${id}`);
	return {
		id,
		name: RUNGS[at].name,
		can: RUNGS.slice(0, at + 1).map((r) => r.grant),
		cannot: RUNGS.slice(at + 1).map((r) => r.grant),
		tools: RUNGS.slice(0, at + 1).flatMap((r) => r.tools),
	};
}

/**
 * The tools to activate for a mode, given what this session actually has.
 * Intersected rather than sent verbatim: `powershell` is absent off Windows, and
 * a mode that names a tool the registry does not have would never match itself
 * back, leaving the button stuck on Custom.
 */
export function modeToolNames(id: ToolModeId, available: string[]): string[] {
	const wanted = new Set(describeMode(id).tools);
	return available.filter((name) => wanted.has(name) || isExtensionTool(name));
}

/**
 * Which mode the active set is, or null for Custom. Extension tools are ignored
 * on both sides: they are not part of any mode, so switching one off by hand
 * should not rename the mode.
 */
export function activeModeId(active: string[], available: string[]): ToolModeId | null {
	const on = new Set(active.filter((name) => !isExtensionTool(name)));
	const found = MODE_IDS.find((id) => {
		const wanted = modeToolNames(id, available).filter((name) => !isExtensionTool(name));
		return wanted.length === on.size && wanted.every((name) => on.has(name));
	});
	return found ?? null;
}
