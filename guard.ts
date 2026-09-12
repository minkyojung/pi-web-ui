/**
 * What pi is told about the vault, and what it is kept out of.
 *
 * Three things a note app on the pi harness needs from pi's own extension
 * points, none of which the tool ladder gives:
 *
 * - A system prompt that says this is a folder of notes: what a note is, that
 *   `.pi/` is the app's and not to be touched, and how to point at a note.
 *   Without it pi runs its stock coding-agent prompt over someone's writing.
 * - A hard stop on `.pi/`. The history there is the record of who wrote
 *   what; a tool call that rewrites or removes it corrupts that silently, so
 *   `edit`, `write` and `bash` are blocked before they run, whatever the
 *   mode. The instruction above is the soft version; this is the one that
 *   holds when the instruction is forgotten.
 * - A hard stop on writing a note by hand. A note is written by the app's own
 *   pair — see noteEdit.ts — which refuses a write made on a version the
 *   person has typed past, and records whose words the new ones are. `edit`
 *   and `write` can do neither, so on a note they are refused and told where
 *   to go instead. Every other file in the folder is pi's as it always was.
 * - The note open in the editor, and the words chosen in it, given as lines of
 *   the system prompt for the turn rather than as text in the person's
 *   message. As user text they were kept in the session, compacted with it,
 *   and replayed with a stale path when a question was asked again or a
 *   branch navigated — and what is chosen belongs to the moment even more
 *   than the path does.
 *
 * Inline, like recorder.ts, and bound per session with it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, sep } from "node:path";
import { notePath } from "./vault.ts";

/** What the app keeps beside the notes. Nothing of pi's may go there. */
export const APP_DIR_NAME = ".pi";

export const VAULT_PROMPT = [
	"You are working in a folder of a person's notes: markdown files (.md), one note per file, the file's name being the note's title.",
	"Read notes with read, grep, find and ls; change them with note_edit, or note_write for a new note. Keep a note's existing style, headings and links.",
	"edit and write are refused on a note, because what they write could not be told from the person's own words; they are for every other file here.",
	`The folder ${APP_DIR_NAME}/ belongs to the app that shows these notes — it holds the record of who wrote what — and must not be read as notes, written, or removed; tools that try are refused.`,
	"When you refer to a note, use its path relative to this folder.",
].join(" ");

/** Why a note cannot be written by hand, and what to use instead. */
export const NOT_BY_HAND = (path: string) =>
	`${path} is a note. Notes are changed with note_edit, or note_write for a new one, so that your words are kept as yours and the person can accept them or put them back. edit and write are for every other file here.`;

/** Whether a path, as a tool would take it, lies under the app's folder. */
export function underAppDir(root: string, given: string): boolean {
	const rel = isAbsolute(given) ? relative(root, given) : given;
	const first = rel.split(/[\\/]/)[0];
	return first === APP_DIR_NAME;
}

/**
 * Whether a shell command reaches into the app's folder. A pattern, not a
 * parse: `.pi/` or a bare `.pi` as a word is not something a note needs, so
 * any mention is refused rather than only the ones a parser would catch.
 */
export function mentionsAppDir(command: string): boolean {
	return new RegExp(`(^|[\\s"'\`=:(])\\${APP_DIR_NAME}(?=[/\\s"'\`)]|$)`).test(command);
}

/** The note open in the editor, and the words chosen in it, if any. */
export type OpenNote = () => { path: string; chosen: string | null } | null;

/** The line of the turn's system prompt that says what the person is looking at. */
export function looking(note: { path: string; chosen: string | null }): string {
	const line = `The person has this note open in their editor right now: ${note.path}`;
	if (!note.chosen) return line;
	// Quoted, and said to be a part of the note rather than a thing to answer
	// about on its own: the question is the message, this is what it points at.
	return `${line}\nThey have chosen these words in it, which is what their message is about unless they say otherwise:\n${note.chosen
		.split("\n")
		.map((words) => `> ${words}`)
		.join("\n")}`;
}

export const guard = (root: string, openNote: OpenNote) => (pi: ExtensionAPI) => {
	pi.on("tool_call", async (event) => {
		const input = event.input as { path?: unknown; command?: unknown };
		if ((event.toolName === "edit" || event.toolName === "write") && typeof input.path === "string") {
			if (underAppDir(root, input.path)) {
				return { block: true, reason: `${input.path} is under ${APP_DIR_NAME}/, which belongs to the app and is not to be changed.` };
			}
			if (notePath(root, input.path)) {
				return { block: true, reason: NOT_BY_HAND(input.path) };
			}
		}
		if (event.toolName === "bash" && typeof input.command === "string" && mentionsAppDir(input.command)) {
			return { block: true, reason: `Commands must not touch ${APP_DIR_NAME}/; it belongs to the app that shows these notes.` };
		}
		return undefined;
	});

	pi.on("before_agent_start", async (event) => {
		const note = openNote();
		if (!note) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${looking(note)}` };
	});
};
