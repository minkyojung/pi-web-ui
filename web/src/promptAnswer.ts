/**
 * How an answer is spelled for the extension's decoders.
 *
 * Pure, so it can be tested without a browser. The shapes are the ones its own
 * TUI adapter and batch decoder produce: a string for select/input/editor,
 * "true"/"false" for confirm, a JSON array string for multiselect — where an
 * empty selection is a real answer, distinct from cancelling — and for a batch,
 * a JSON array aligned by index with one object per sub-question.
 */
import type { PromptRequest, PromptType } from "./types";

export interface BatchQuestion {
	method: "input" | "select" | "multiselect" | "confirm";
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	/** A choice that may be answered in the person's own words — ask_user's are, see askUser.ts. */
	other?: boolean;
}

/**
 * What a question's controls hold when the form is sent: the choices taken, by
 * their place in `options`, and what is on the line to write in — null when
 * that line is empty or the question has none. A question passed over holds
 * nothing. By place, not by text, because a model may offer the same words twice.
 */
export interface Filled {
	picked: number[];
	written: string | null;
}

/** A value as the card holds it: text, one option, several, or yes/no. */
export type AnswerValue = string | string[] | boolean;

export function encodeAnswer(type: Exclude<PromptType, "batch">, value: AnswerValue): string {
	switch (type) {
		case "confirm":
			return value === true ? "true" : "false";
		case "multiselect":
			return JSON.stringify(Array.isArray(value) ? value : []);
		default:
			return typeof value === "string" ? value : "";
	}
}

export function encodeBatchAnswer(questions: BatchQuestion[], values: AnswerValue[]): string {
	return JSON.stringify(
		questions.map((q, i) => {
			const v = values[i];
			if (q.method === "confirm") return { confirmed: v === true };
			if (q.method === "multiselect") return { values: Array.isArray(v) ? v : [] };
			return { value: typeof v === "string" ? v : "" };
		}),
	);
}

/**
 * The value a question was answered with, from what its controls held. Nothing
 * taken is an answer too: no for a confirm, none for a multiselect, empty text.
 * What was written beside a list of choices is the choice, or one more of them.
 */
export function answerOf(question: BatchQuestion, filled: Filled): AnswerValue {
	const options = question.options ?? [];
	const picked = filled.picked.flatMap((i) => (options[i] === undefined ? [] : [options[i]]));
	switch (question.method) {
		case "confirm":
			return filled.picked[0] === 0;
		case "select":
			return filled.written ?? picked[0] ?? "";
		case "multiselect":
			return filled.written === null ? picked : [...picked, filled.written];
		default:
			return filled.written ?? "";
	}
}

/** Yes and no, as the two choices of a confirm: yes is the first. */
export const CONFIRM = ["Yes", "No"];

/**
 * Every question a prompt asks, a batch's or the one: the one is read as a
 * batch question is, so that both are drawn and answered the same way.
 * Not for an editor, which is a page of text and not a question of these kinds.
 */
export function questionsOf(prompt: PromptRequest): BatchQuestion[] {
	if (prompt.type === "batch") return batchQuestions(prompt);
	if (prompt.type === "editor") return [];
	const message = prompt.metadata?.message;
	return [
		{
			method: prompt.type,
			title: prompt.question,
			message: typeof message === "string" ? message : undefined,
			options: prompt.options,
			placeholder: prompt.defaultValue,
			other: prompt.metadata?.other === true,
		},
	];
}

/** The answer as it is sent, from the value each question was answered with. */
export function encodeAnswers(prompt: PromptRequest, questions: BatchQuestion[], values: AnswerValue[]): string {
	if (prompt.type === "batch") return encodeBatchAnswer(questions, values);
	return encodeAnswer(prompt.type, values[0] ?? "");
}

/** The sub-questions a batch carries in its metadata, or none if malformed. */
export function batchQuestions(prompt: PromptRequest): BatchQuestion[] {
	const raw = prompt.metadata?.questions;
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((q): BatchQuestion[] => {
		if (!q || typeof q !== "object") return [];
		const { method, title, message, options, placeholder, other } = q as Record<string, unknown>;
		if (method !== "input" && method !== "select" && method !== "multiselect" && method !== "confirm") return [];
		return [
			{
				method,
				title: typeof title === "string" ? title : "Question",
				message: typeof message === "string" ? message : undefined,
				options: Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : undefined,
				placeholder: typeof placeholder === "string" ? placeholder : undefined,
				other: other === true,
			},
		];
	});
}
