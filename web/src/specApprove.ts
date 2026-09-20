/**
 * Approving from the window: the same command, sent for the person.
 *
 * There is no approving in the window. The command is the approval — the code
 * behind it writes the record and the agent is set going (spec.ts) — so what a
 * button does is type `/spec-approve` and press send, exactly as the person
 * would, with the spec's name always given so that the question pi asks when
 * several are waiting never has to be answered here.
 *
 * What may stop it is here too, because a command is not a message: pi runs an
 * extension command before it looks at what is streaming, so one sent while
 * the agent is working is refused with a warning rather than queued the way a
 * message is. A control that would only earn that warning is better disabled,
 * and better still saying why — which is what these two functions are for.
 *
 * Pure. The stores are read where they are drawn.
 */
import type { ClientMsg } from "../../protocol.ts";

/** Its name on pi's list of commands (CommandsMsg), which is how the window knows it is there. */
export const APPROVE = "spec-approve";

/** What the person would type. */
export const approveCommand = (name: string): string => `/${APPROVE} ${name}`;

/** And what the box sends when they do — see Composer.tsx. */
export const approveMessage = (name: string): ClientMsg => ({ type: "prompt", text: approveCommand(name), command: true, behavior: "followUp" });

/** Why approving cannot be done now, or null when it can. */
export type Block = "offline" | "busy" | "no-command" | "sent" | null;

/** What stands in the way, the most immediate first. */
export function blocked(now: { online: boolean; streaming: boolean; compacting: boolean; hasCommand: boolean; sent: boolean }): Block {
	if (!now.online) return "offline";
	if (now.streaming || now.compacting) return "busy";
	if (!now.hasCommand) return "no-command";
	if (now.sent) return "sent";
	return null;
}

const REASONS: Record<NonNullable<Block>, string> = {
	offline: "Not connected",
	busy: "The agent is working",
	// The command belongs to the spec extension, which a folder's session may
	// have been started without; saying so beats a control that does nothing.
	"no-command": "Spec commands are not loaded here",
	sent: "Approving…",
};

/** That, in words, for the line the control sits in. */
export const why = (block: Block): string | null => (block === null ? null : REASONS[block]);
