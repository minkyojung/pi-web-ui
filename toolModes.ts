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
 * The ladder tools are pi's own eight built-ins (core/tools/index.js), plus
 * the three a note is written by — those are ours, but they are writing all
 * the same, and a Plan mode that let the agent rewrite a note, or refile it
 * by its properties, would not be one.
 * Anything else in the registry is an extension tool; it sits outside the
 * ladder. `ask_user` stays on in every mode, since it is what makes read-only
 * planning conversational in the first place. The web has a switch of its own
 * beside the ladder — see WEB_TOOLS below for why it is not a rung.
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
	{ id: "coding", name: "Coding", tools: ["edit", "write", "note_edit", "note_write", "note_properties"], grant: "Edit and create files" },
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
 * Coding rather than full: pi does not ask before it runs a shell command, so
 * the rung is the only line there is, and the first person to open Octave on
 * their notes has not been told that the agent at the table can run one. The
 * shell is one step up, taken on purpose. It was full while the only user was
 * the one who built it — the setting remembers a change (settings.ts), so
 * this is only where a fresh install begins.
 */
export const DEFAULT_MODE: ToolModeId = "coding";

const LADDER_TOOLS = new Set(RUNGS.flatMap((r) => r.tools));

/** A tool pi did not build in — an extension's. Outside the ladder. */
export const isExtensionTool = (name: string) => !LADDER_TOOLS.has(name);

/**
 * The web (pi-web-access, loaded in server.ts): a switch beside the ladder
 * rather than a rung on it.
 *
 * The ladder asks what happens to your notes — read, then write, then the
 * shell — and each rung contains the one below it, which is what lets three
 * names stand for eight tools. The web asks something else entirely: what
 * leaves this machine (the words you chose, sent to a search provider) and
 * what comes back into the conversation (a page somebody else wrote). That is
 * neither above writing nor below it, so it has no rung: put it in Plan and
 * every mode has it, put it in Coding and planning with the web is impossible,
 * put it in Full and a search costs you the shell.
 *
 * The same split the rest of the field settled on — Claude Code manages web
 * access apart from file permissions, Codex and Cursor have a network switch
 * beside the sandbox, none of them make the network a rung of the write
 * ladder.
 *
 * On by default, since it is on in every mode unless the switch says no, and
 * off it stays off through a change of mode (ToolModes.tsx).
 */
export const WEB_TOOLS = ["web_search", "fetch_content", "source_check", "get_search_content"];

export const isWebTool = (name: string) => WEB_TOOLS.includes(name);

/**
 * Where the switch stands: on when any of its tools is. One of the four turned
 * off by hand in the per-tool list is still the web being on.
 */
export const isWebOn = (active: string[]) => active.some(isWebTool);

/**
 * An active set with the switch put where it is asked for.
 *
 * It is also how a mode is picked without moving the switch:
 * `withWeb(modeToolNames(id, available), available, isWebOn(active))`. Modes
 * are generous with extension tools by design, which on its own would turn the
 * web back on every time somebody changed rung.
 */
export function withWeb(names: string[], available: string[], on: boolean): string[] {
	if (!on) return names.filter((name) => !isWebTool(name));
	return [...names, ...available.filter((name) => isWebTool(name) && !names.includes(name))];
}

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
