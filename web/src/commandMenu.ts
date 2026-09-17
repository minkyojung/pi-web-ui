/**
 * Type `/` and the commands are offered.
 *
 * What the box holds is read the way pi's terminal reads its own input: a
 * line that is nothing but a slash and a word is a command being named, and
 * the list narrows as the word grows; a space after the word means its
 * arguments are being written, and the list has done its part. What is
 * named — the first word, if it is on the list — is what the server is told
 * is a command (CommandsMsg, `command` on the prompt), and a first word that
 * is not is a character like any other.
 *
 * Pure, so it can be tested without a box.
 */
import type { CommandInfo } from "../../protocol.ts";

/** The word being typed after a leading slash, or null when the box is not naming a command. */
export function commandQuery(text: string): string | null {
	const m = /^\/(\S*)$/.exec(text);
	return m ? m[1] : null;
}

/**
 * The commands the word could mean, in pi's order within each rank: those
 * the word begins, then those it appears in. Case does not matter.
 */
export function matchCommands(commands: CommandInfo[], query: string): CommandInfo[] {
	const q = query.toLowerCase();
	if (!q) return commands;
	const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
	const within = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
	return [...starts, ...within];
}

/** Whether the text's first word names one of the commands — `/name` alone or with arguments after it. */
export function namesCommand(commands: CommandInfo[], text: string): boolean {
	const m = /^\/(\S+)(?:\s|$)/.exec(text);
	return m !== null && commands.some((c) => c.name === m[1]);
}

/** The box with the command written in and a space after it, ready for arguments. */
export function acceptCommand(name: string): string {
	return `/${name} `;
}
