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

/** The sub-questions a batch carries in its metadata, or none if malformed. */
export function batchQuestions(prompt: PromptRequest): BatchQuestion[] {
	const raw = prompt.metadata?.questions;
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((q): BatchQuestion[] => {
		if (!q || typeof q !== "object") return [];
		const { method, title, message, options, placeholder } = q as Record<string, unknown>;
		if (method !== "input" && method !== "select" && method !== "multiselect" && method !== "confirm") return [];
		return [
			{
				method,
				title: typeof title === "string" ? title : "Question",
				message: typeof message === "string" ? message : undefined,
				options: Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : undefined,
				placeholder: typeof placeholder === "string" ? placeholder : undefined,
			},
		];
	});
}
