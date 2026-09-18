/**
 * Questions for the bench: one of each kind the agent, an extension or the
 * server can ask, and the ones that are hard on the layout — many choices,
 * long ones, a batch with every kind in it. Written, not recorded: a question
 * is not a conversation event, and no recording holds one.
 */
import type { PromptRequest } from "../types";

export interface QuestionSample {
	id: string;
	name: string;
	/** Drawn as it is while a run is going, with the way to stop it. */
	streaming?: boolean;
	prompt: PromptRequest;
}

const ask = (id: string, rest: Omit<PromptRequest, "id" | "pipeline">): PromptRequest => ({ id, pipeline: "octave", ...rest });

export const questions: QuestionSample[] = [
	{ id: "confirm", name: "confirm", streaming: true, prompt: ask("confirm", { type: "confirm", question: "Delete the 14 empty notes in Inbox?", metadata: { message: "They have no text and nothing links to them." } }) },
	{ id: "select", name: "select · ask_user", streaming: true, prompt: ask("select", { type: "select", question: "Which note should the summary go in?", options: ["Today's note", "A new note beside the PDF", "The project's index"], metadata: { other: true } }) },
	{ id: "select-plain", name: "select · extension (no line to write in)", prompt: ask("select-plain", { type: "select", question: "Summarize branch?", options: ["No summary", "Summarize", "No summary, don't ask again"] }) },
	{ id: "multiselect", name: "multiselect · ask_user", streaming: true, prompt: ask("multiselect", { type: "multiselect", question: "Which folders should be searched?", options: ["Projects", "Meetings", "Reading", "Archive"], metadata: { message: "Pick none to search everything.", other: true } }) },
	{ id: "input", name: "input", streaming: true, prompt: ask("input", { type: "input", question: "What should the new note be called?", defaultValue: "e.g. Reading list" }) },
	{ id: "editor", name: "editor · extension", prompt: ask("editor", { type: "editor", question: "Edit the commit message", defaultValue: "Fix the thing\n\nIt was broken in two places." }) },
	{
		id: "many",
		name: "select · twelve choices, some long, two the same",
		streaming: true,
		prompt: ask("many", {
			type: "select",
			question: "Which of these is closest to what you meant by “the old layout”, given that there have been several?",
			options: ["The one before the sidebar became a tree", "The one with pi docked at the bottom", "The same", "The same", "Five", "Six", "Seven", "Eight", "Nine", "Ten — past the last number key", "Eleven", "A long one: the layout from the first release, where the note took the whole window and the agent was a drawer that came in from the right"],
			metadata: { other: true },
		}),
	},
	{
		id: "batch",
		name: "batch · every kind",
		streaming: true,
		prompt: ask("batch", {
			type: "batch",
			question: "Setting up the weekly review",
			metadata: {
				message: "Four things before the first one is written.",
				questions: [
					{ method: "select", title: "Which day does the week end?", options: ["Friday", "Sunday"], other: true },
					{ method: "multiselect", title: "What should it gather?", message: "From the week's notes.", options: ["Tasks done", "Tasks open", "Meetings", "Reading"], other: true },
					{ method: "confirm", title: "Link it from the day's note?" },
					{ method: "input", title: "Anything it should always end with?", placeholder: "e.g. One thing to drop next week" },
				],
			},
		}),
	},
	{ id: "malformed", name: "batch · nothing in it that can be shown", prompt: ask("malformed", { type: "batch", question: "Setup", metadata: { questions: [{ method: "dance" }] } }) },
];
