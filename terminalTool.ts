/**
 * pi reading the terminal: what is on the screen of a shell the person
 * has open under the note.
 *
 * The agent has a bash of its own for what it wants run; this is for what
 * it cannot run again — the dev server the person started and left going,
 * the test they ran by hand, the error that is sitting there — read off
 * the screen the server keeps for each terminal (pty/screen.ts), as words:
 * the last lines of the screen and the scrollback, no colours, no cursor.
 * Reading only: nothing is typed into a shell the person is typing in.
 * Outside the mode ladder (toolModes.ts) as every extension tool is, so it
 * is there in Plan as in Execution — it changes nothing.
 *
 * Conductor's core has the same call (pty_screen_text).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

const schema = Type.Object({
	terminal: Type.Optional(Type.String({ description: "Which terminal: its id, as `list` shows them (e.g. \"2\"). Without it, the one the person has in front, or the only one." })),
	lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000, description: "How many lines from the end to read. Defaults to 200." })),
	list: Type.Optional(Type.Boolean({ description: "true: say which terminals there are, and read none." })),
});
type Params = Static<typeof schema>;

/** A terminal as the tool sees it. */
export type Readable = { id: string; shell: string; text(lines: number): string };

const DEFAULT_LINES = 200;

const said = (text: string, details: Record<string, unknown>) => ({ content: [{ type: "text" as const, text }], details });

/** Which terminal `terminal` names, or the front one, or the only one — null with a sentence when none. */
export function pick(terminals: Readable[], front: string | null, wanted: string | undefined): { terminal: Readable } | { error: string } {
	if (terminals.length === 0) return { error: "The person has no terminal open in this workspace. Run the command yourself with bash if you need its output." };
	if (wanted !== undefined) {
		const found = terminals.find((t) => t.id === wanted);
		return found ? { terminal: found } : { error: `There is no terminal "${wanted}". There are: ${terminals.map((t) => `${t.shell} ${t.id}`).join(", ")}.` };
	}
	const inFront = front !== null ? terminals.find((t) => t.id === front) : undefined;
	return { terminal: inFront ?? terminals[0]! };
}

/**
 * `terminals` and `front` are looked up when the tool runs, not when it is
 * made: the session, and this tool with it, is built before any shell is.
 */
export const readTerminal = (terminals: () => Readable[], front: () => string | null) => (pi: ExtensionAPI) => {
	pi.registerTool({
		name: "read_terminal",
		label: "Read the terminal",
		description:
			"Read what is on the screen of a terminal the person has open in this workspace: the last lines of its output and scrollback, as plain text. " +
			"Use it to see the output of something the person ran or left running — a dev server, a test, a build — rather than running it again; run your own commands with bash. " +
			"Reading only: it types nothing. With `list: true` it says which terminals there are.",
		parameters: schema,
		execute: async (_id, params: Params) => {
			const all = terminals();
			if (params.list) {
				if (all.length === 0) return said("The person has no terminal open in this workspace.", { terminals: [] });
				return said(all.map((t) => `${t.shell} ${t.id}`).join("\n"), { terminals: all.map(({ id, shell }) => ({ id, shell })) });
			}
			const chosen = pick(all, front(), params.terminal);
			if ("error" in chosen) return said(chosen.error, { terminals: all.map(({ id, shell }) => ({ id, shell })) });
			const lines = params.lines ?? DEFAULT_LINES;
			const text = chosen.terminal.text(lines);
			const head = `${chosen.terminal.shell} ${chosen.terminal.id}, the last ${lines} lines:`;
			return said(text.length === 0 ? `${head}\n(nothing on the screen yet)` : `${head}\n\n${text}`, { terminal: chosen.terminal.id, lines });
		},
	});
};
