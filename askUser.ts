/**
 * pi asking the person something, answered in the browser.
 *
 * This used to be the dashboard extension's tool, with its bus between the
 * tool and us. The bus went through a gateway that answered slowly for a
 * real folder — a second and more on every new session, since pi restarts
 * every extension when the session changes — and the tool was the one thing
 * of the dashboard's this app needed. So the tool is ours: the same name and
 * the same five kinds of question, so that pi asks the way it already knows
 * how, and the same card in the browser, since the question goes out in the
 * shape the card already reads. What is asked waits in prompts.ts.
 *
 * The parameters are one flat object rather than a union of five: some
 * providers insist on an object at the root of a tool's schema. What each
 * kind needs is said in the description and checked when the tool runs.
 * Models get the shape wrong in a few known ways — `question` for `title`,
 * options as a JSON string, options as {label, value} pairs — and those are
 * mended in prepareArguments before the schema is checked, as the dashboard
 * mended them.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import { Cancelled } from "./prompts.ts";
import type { PromptRequest } from "./protocol.ts";

const KINDS = ["confirm", "select", "multiselect", "input", "batch"] as const;
type Kind = (typeof KINDS)[number];

const subQuestion = Type.Object(
	{
		method: Type.Union([Type.Literal("confirm"), Type.Literal("select"), Type.Literal("multiselect"), Type.Literal("input")], {
			description: "Sub-question kind. Cannot be 'batch' (no nesting).",
		}),
		title: Type.String({ description: "Short title / question text for this sub-question" }),
		options: Type.Optional(Type.Array(Type.String(), { description: "Choices for select (>=2) and multiselect (>=1). Plain strings." })),
		placeholder: Type.Optional(Type.String({ description: "Placeholder for 'input'" })),
		message: Type.Optional(Type.String({ description: "Additional context for this sub-question" })),
	},
	{ description: "One question inside a batch." },
);

const schema = Type.Object(
	{
		method: Type.Union(
			KINDS.map((k) => Type.Literal(k)),
			{ description: "Question kind. 'confirm' = yes/no, 'select' = pick one of options[], 'multiselect' = pick many of options[], 'input' = free text, 'batch' = several questions answered together." },
		),
		title: Type.Optional(Type.String({ description: "Short title / question text. Required for every kind but batch, which may take it from its first question." })),
		message: Type.Optional(Type.String({ description: "Additional context shown alongside the question(s)." })),
		options: Type.Optional(Type.Array(Type.String(), { description: "Required for 'select' (>=2 items) and 'multiselect' (>=1 item). Plain string[] — not [{label, value}]. Ignored for other kinds." })),
		placeholder: Type.Optional(Type.String({ description: "Placeholder for 'input'. Ignored for other kinds." })),
		questions: Type.Optional(Type.Array(subQuestion, { description: "Required for 'batch' (>=1 question). Each is its own confirm/select/multiselect/input — none can be a batch." })),
	},
	{ description: "The required fields depend on `method`: confirm→title; select→title+options(>=2); multiselect→title+options(>=1); input→title; batch→questions." },
);
export type AskUserParams = Static<typeof schema>;

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

/** Options as strings, whatever the model sent: a JSON string of them, or {label, value} pairs. */
function optionsOf(value: unknown): unknown {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? optionsOf(parsed) : value;
		} catch {
			return value;
		}
	}
	if (Array.isArray(value) && value.length > 0 && value.every((o) => isObject(o) && typeof o.label === "string")) {
		return value.map((o) => (o as Loose).label);
	}
	return value;
}

/** One question's fields in their own names: `title` for what the model may have called `question` or `header`. */
function normalizeOne(raw: unknown): unknown {
	if (!isObject(raw)) return raw;
	let q = { ...raw };
	// A wrapper some models put the kind and choices in.
	if (isObject(q.input_type)) {
		const { input_type, ...rest } = q;
		q = { ...input_type, ...rest };
	}
	if (q.title === undefined) {
		if (typeof q.question === "string") q.title = q.question;
		else if (typeof q.header === "string") q.title = q.header;
	}
	delete q.question;
	delete q.header;
	if (q.options !== undefined) q.options = optionsOf(q.options);
	return q;
}

/**
 * The arguments as the schema expects them, from the arguments as the model
 * sent them. Pure, and tested on its own. What it cannot mend is left as is
 * for the schema to refuse.
 */
export function normalize(args: unknown): unknown {
	if (!isObject(args)) return args;
	let q = { ...args };
	// The whole thing wrapped in `params`, as a string or an object.
	if (q.params !== undefined) {
		const inner = typeof q.params === "string" ? (() => { try { return JSON.parse(q.params as string); } catch { return undefined; } })() : q.params;
		if (isObject(inner)) {
			const { params, ...rest } = q;
			q = { ...inner, ...rest };
		}
	}
	q = normalizeOne(q) as Loose;
	if (typeof q.questions === "string") {
		try {
			const parsed = JSON.parse(q.questions);
			if (Array.isArray(parsed)) q.questions = parsed;
		} catch {
			// Left for the schema.
		}
	}
	const questions = q.questions;
	if (Array.isArray(questions)) {
		q.questions = questions.map(normalizeOne);
		if (q.method === undefined && questions.length > 0) q.method = "batch";
		if (q.method === "batch" && q.title === undefined) {
			const first = normalizeOne(questions[0]);
			q.title = isObject(first) && typeof first.title === "string" ? first.title : "Questions";
		}
	}
	return q;
}

/** What the card answered, in the shape the tool reports: yes/no, a choice, several, text. See promptAnswer.ts in the client. */
export function decode(kind: Exclude<Kind, "batch">, answer: string): unknown {
	switch (kind) {
		case "confirm":
			return answer === "true";
		case "multiselect":
			try {
				const parsed = JSON.parse(answer);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		default:
			return answer;
	}
}

/** A batch's answers, one per question, in the shape each question's kind reports. */
export function decodeBatch(answer: string): unknown[] {
	try {
		const parsed = JSON.parse(answer);
		if (!Array.isArray(parsed)) return [];
		return parsed.map((a) => {
			if (isObject(a)) {
				if ("confirmed" in a) return a.confirmed;
				if ("values" in a) return a.values;
				if ("value" in a) return a.value;
			}
			return a;
		});
	} catch {
		return [];
	}
}

type Question = Omit<PromptRequest, "id" | "pipeline">;

/** The question as the card reads it, from the arguments as the schema passed them. */
export function questionOf(params: AskUserParams): Question {
	const title = params.title || params.message || "Question";
	const metadata: Record<string, unknown> = {};
	if (params.message) metadata.message = params.message;
	if (params.method === "batch") {
		metadata.questions = (params.questions ?? []).map((q) => ({
			method: q.method,
			title: q.title || "Question",
			...(q.message ? { message: q.message } : {}),
			...(q.options ? { options: q.options } : {}),
			...(q.placeholder ? { placeholder: q.placeholder } : {}),
		}));
		return { type: "batch", question: params.title || "Questions", metadata };
	}
	return {
		type: params.method,
		question: title,
		...(params.method === "select" || params.method === "multiselect" ? { options: params.options } : {}),
		...(params.method === "input" && params.placeholder ? { defaultValue: params.placeholder } : {}),
		...(Object.keys(metadata).length ? { metadata } : {}),
	};
}

/** A choice with nothing to choose from is a mistake the model can fix, so it is told rather than shown an empty card. */
function check(params: AskUserParams): void {
	const needs = (kind: string, options: unknown, where: string) => {
		const min = kind === "select" ? 2 : 1;
		if ((kind === "select" || kind === "multiselect") && (!Array.isArray(options) || options.length < min)) {
			throw new Error(`ask_user${where}: method "${kind}" needs "options" with at least ${min} item(s). Received: ${JSON.stringify(options)}. With nothing to choose from, use method "input".`);
		}
	};
	if (params.method === "batch") {
		if (!params.questions?.length) throw new Error('ask_user: method "batch" needs at least one entry in "questions".');
		params.questions.forEach((q, i) => needs(q.method, q.options, ` batch question ${i + 1}`));
	} else {
		needs(params.method, params.options, "");
	}
}

const said = (text: string, details: Record<string, unknown>) => ({ content: [{ type: "text" as const, text }], details });

/**
 * The tool. `ask` is looked up when a question is asked, not when the tool
 * is made: the session, and this tool with it, is built before the bridge
 * that will carry the question exists.
 */
export const askUser = (ask: () => (question: Question) => Promise<string>) => (pi: ExtensionAPI) => {
	pi.registerTool({
		name: "ask_user",
		label: "Ask the person",
		description:
			"Ask the person a question and wait for the answer. Use it when what to do next depends on something only they know: a choice between real alternatives, a fact you cannot find, a yes or no before something hard to undo. Five kinds: confirm (yes/no), select (one of options[]), multiselect (several of options[]), input (free text), batch (several questions answered together, none of them a batch). Send options as a plain string[], not [{label, value}].",
		promptSnippet: "Ask the person a question — a choice, a yes/no, or free text — and wait for the answer",
		promptGuidelines: [
			"Ask with ask_user rather than ending the turn with a question in your text: the tool waits for the answer, the text does not.",
			"Prefer select over input when the alternatives are known; the person picks rather than types.",
			"Several related questions go in one batch, so the person sees one card.",
		],
		parameters: schema,
		prepareArguments: (args) => normalize(args) as AskUserParams,
		execute: async (_id, params) => {
			check(params);
			const question = questionOf(params);
			let answer: string;
			try {
				answer = await ask()(question);
			} catch (err) {
				if (err instanceof Cancelled) {
					return said("The person closed the question without answering.", { method: params.method, cancelled: true });
				}
				throw err;
			}
			if (params.method === "batch") {
				const results = decodeBatch(answer);
				const lines = [`User completed batch (${results.length} answers).`];
				(params.questions ?? []).forEach((q, i) => lines.push(`  ${i + 1}. ${q.title}: ${JSON.stringify(i < results.length ? results[i] : "(not asked)")}`));
				return said(lines.join("\n"), { method: "batch", results, cancelled: false });
			}
			const result = decode(params.method, answer);
			return said(`User responded: ${JSON.stringify(result)}`, { method: params.method, result, cancelled: false });
		},
	});
};
