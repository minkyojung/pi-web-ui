/**
 * Asking pi about a chosen part of a note, and putting the answer under it.
 *
 * The part is chosen in the editor, so the app — not pi — knows where the
 * answer belongs. The chosen text rides into the question as a quote, and the
 * place it was chosen at stays on the server, mapped through the note's log
 * while pi thinks, so it still names the same words when the answer arrives.
 * Zed's inline assistant and Cursor's ⌘K are built the same way round: the app
 * owns the place, the model only writes the words.
 *
 * This file is the pi side of it. The turn is told it is answering into a
 * note; it is kept from writing the note itself, so that the one path a note
 * is written by stays one; and the answer is handed back when the run ends.
 * Inline, like guard.ts and recorder.ts, and bound per session with them.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NOTE_TOOLS } from "./noteEdit.ts";

/** A part of a note, chosen in the editor. `id` is the tab's own count of asks, sent back with the outcome. */
export type Ask = { id: number; path: string; from: number; to: number };

/** How an ask ended. Only `written` put anything in the note. */
export type AskOutcome =
	/** The answer is in the note, as pi's words, waiting to be accepted. */
	| "written"
	/** The chosen part was gone by the time the answer came, so nothing was written. */
	| "gone"
	/** Something else was said to pi first, and which reply was the answer could no longer be told. */
	| "interrupted"
	/** pi ended the run with nothing to write, or the note refused the write. */
	| "failed";

const INSTRUCTION = [
	"The person chose a part of the note they have open and asked about it: the quote at the top of their message is that part.",
	"Your reply is put into the note under it, so write it as note prose — a few sentences, no preamble, no headings, and no restating of the question.",
	"Do not edit or write the note yourself; the app puts your answer in, and edits are refused for this turn.",
].join(" ");

const REFUSAL = "You are answering about a part of a note. The app writes your answer into it — say the answer instead of editing.";

/** The question as pi receives it: what was chosen, then what was asked about it. */
export function asked(quote: string, question: string): string {
	return `${quote.split("\n").map((line) => `> ${line}`).join("\n")}\n\n${question}`;
}

/**
 * The note with the answer in it: its own paragraph, under the line the chosen
 * words end on.
 *
 * Under the line rather than at the words themselves, because a note is read
 * by its paragraphs — an answer spliced into the middle of a sentence is not
 * an answer to it. `to` is where the chosen words end in `text` now, which is
 * not where they ended when they were chosen; see mapThrough in history.ts.
 */
export function under(text: string, to: number, answer: string): string {
	const lineEnd = text.indexOf("\n", to);
	const at = lineEnd === -1 ? text.length : lineEnd;
	return `${text.slice(0, at)}\n\n${answer}${text.slice(at)}`;
}

/**
 * What pi said last, or null if the run ended with nothing to write.
 *
 * Shaped rather than imported, the way conversation.js reads the same
 * messages: a run that was stopped or failed ends on the message that was in
 * flight when it went, and half a sentence is not an answer.
 */
type Said = { role?: string; content?: unknown; stopReason?: string };

export function answerOf(messages: readonly unknown[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as Said | undefined;
		if (message?.role !== "assistant") continue;
		if (message.stopReason === "aborted" || message.stopReason === "error") return null;
		if (!Array.isArray(message.content)) return null;
		const text = message.content
			.filter((part): part is { type: "text"; text: string } => (part as { type?: string })?.type === "text")
			.map((part) => part.text)
			.join("")
			.trim();
		return text || null;
	}
	return null;
}

/** Handed the answer, the session it was said in, and the message that said it. */
export type OnAnswer = (answer: string | null, sessionId: string, entryId?: string) => void;

export const answering = (asking: () => boolean, onAnswer: OnAnswer) => (pi: ExtensionAPI) => {
	pi.on("before_agent_start", async (event) => {
		if (!asking()) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${INSTRUCTION}` };
	});

	// The instruction above is the soft version; this is the one that holds
	// when it is forgotten. A note pi edited here would be written twice: once
	// by pi's tool, once by the server putting the answer in.
	//
	// `edit` and `write` are in the list beside the note tools although
	// guard.ts already refuses those on a note: what it recognises as a note
	// and what the file system will accept are not quite the same set, and
	// this refusal costs nothing where they differ.
	pi.on("tool_call", async (event) => {
		if (!asking()) return undefined;
		if (!NOTE_TOOLS.has(event.toolName) && event.toolName !== "edit" && event.toolName !== "write") return undefined;
		return { block: true, reason: REFUSAL };
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!asking()) return;
		onAnswer(answerOf(event.messages), ctx.sessionManager.getSessionId(), ctx.sessionManager.getLeafId() ?? undefined);
	});
};
