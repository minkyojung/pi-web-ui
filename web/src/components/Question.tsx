import { useEffect, useRef, useState } from "react";

import { SquareIcon, X } from "lucide-react";

import { type BatchQuestion, CONFIRM, type Filled, answerOf, encodeAnswers, questionsOf } from "../promptAnswer";
import type { PromptRequest } from "../types";
import { Button } from "./ui/button";
import {
	Questionnaire,
	QuestionnaireActions,
	QuestionnaireChoice,
	QuestionnaireChoices,
	QuestionnaireDescription,
	QuestionnaireError,
	QuestionnaireInput,
	QuestionnaireItem,
	QuestionnaireNext,
	QuestionnairePrevious,
	QuestionnaireProgress,
	QuestionnaireSkip,
	QuestionnaireSubmit,
	QuestionnaireTitle,
} from "./ui/questionnaire";
import { Textarea } from "./ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";

/** The name a question's controls carry in the form, by its place among the questions. */
const nameOf = (i: number) => `q${i}`;
/** What is offered to choose from: the options, or yes and no. */
const choicesOf = (q: BatchQuestion) => (q.method === "confirm" ? CONFIRM : q.method === "input" ? [] : (q.options ?? []));
/** A choice of one must be made; several may be none of them, and a line may be left empty. */
const mustAnswer = (q: BatchQuestion) => q.method === "confirm" || q.method === "select";

/**
 * What the controls named `name` hold. A control the form has taken the name
 * off — a question passed over, a line left empty — is not among them, which
 * is how the form itself leaves those out of what it submits.
 */
function filledIn(form: HTMLFormElement, name: string): Filled {
	const named = [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
	const isChoice = (el: HTMLInputElement) => el.type === "radio" || el.type === "checkbox";
	return {
		picked: named.filter((el) => isChoice(el) && el.checked).map((el) => Number(el.value)),
		written: named.find((el) => !isChoice(el))?.value ?? null,
	};
}

/**
 * A question the agent asked, where the message box is: while it is open,
 * answering it is the one thing there is to write to the agent, so it takes
 * the place of the box rather than a place in the conversation above it.
 *
 * Choices are taken and then sent — a number key or a click takes one, Enter
 * sends — so a choice can be changed before it goes. Closing it answers
 * nothing and lets the agent go on without; stopping, offered while a run is
 * going, ends the run the question belongs to.
 *
 * It says what was answered and does not send it: the gallery draws this
 * with no socket. `onAnswer` and `onCancel` say whether it went, and the
 * controls are let go of only when it did.
 */
export function Question({
	prompt,
	streaming,
	autoFocus,
	onAnswer,
	onCancel,
	onStop,
}: {
	prompt: PromptRequest;
	streaming: boolean;
	autoFocus: boolean;
	onAnswer: (answer: string) => boolean;
	onCancel: () => boolean;
	onStop: () => void;
}) {
	const [sent, setSent] = useState(false);
	const frame = useRef<HTMLDivElement>(null);
	// Once, when the question comes up: a question that arrives later must not
	// be told to take the focus by a prop that happened to change.
	useEffect(() => {
		if (autoFocus) frame.current?.querySelector<HTMLElement>("input:not(:disabled), textarea")?.focus();
	}, []);

	const answer = (text: string) => setSent(onAnswer(text));

	return (
		<div
			ref={frame}
			id="question"
			inert={sent}
			className="relative flex min-h-0 flex-col rounded-md border border-input p-3 shadow-xs dark:bg-input/30 data-sent:opacity-60"
			data-sent={sent ? "" : undefined}
			onKeyDown={(e) => {
				if (e.key === "Escape" && !e.nativeEvent.isComposing) {
					e.preventDefault();
					setSent(onCancel());
				}
			}}
		>
			<div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
				{streaming && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button type="button" variant="ghost" size="icon-xs" aria-label="Stop" onClick={onStop}>
								<SquareIcon />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="top">Stop the run — what the agent has already done stays</TooltipContent>
					</Tooltip>
				)}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button type="button" variant="ghost" size="icon-xs" aria-label="Close the question" onClick={() => setSent(onCancel())}>
							<X />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">Close without answering (Esc)</TooltipContent>
				</Tooltip>
			</div>
			{prompt.type === "editor" ? <Page prompt={prompt} onSubmit={answer} /> : <Form prompt={prompt} onSubmit={answer} />}
		</div>
	);
}

/** The questions, one at a time. */
function Form({ prompt, onSubmit }: { prompt: PromptRequest; onSubmit: (answer: string) => void }) {
	const questions = questionsOf(prompt);
	// Which one is up, kept only for what passing it over is called.
	const [at, setAt] = useState(nameOf(0));
	const current = questions[Number(at.slice(1))];
	// The form, moving to a question, puts the focus on the question as a
	// whole, which is where a number key takes a choice from. One that is only
	// a line to write on has nothing for a key to do but write, so the focus
	// goes to the line.
	const form = useRef<HTMLFormElement>(null);
	useEffect(() => {
		if (current?.method === "input" && form.current?.contains(document.activeElement)) {
			form.current.querySelector<HTMLElement>("fieldset[data-active] input")?.focus();
		}
	}, [at]);

	if (questions.length === 0) {
		return <p className="pr-12 text-sm text-muted-foreground">This question arrived in a shape that cannot be shown.</p>;
	}

	const batch = prompt.type === "batch";
	const message = typeof prompt.metadata?.message === "string" ? prompt.metadata.message : undefined;
	// Given to the form as well as drawn: it is how it knows which number takes which choice.
	const items = questions.map((q, i) => ({
		name: nameOf(i),
		required: mustAnswer(q),
		choices: choicesOf(q).map((_, j) => ({ value: String(j) })),
	}));

	return (
		<Questionnaire
			ref={form}
			className="min-h-0"
			items={items}
			shortcuts="numbers"
			onItemChange={setAt}
			onSubmit={(e) => {
				e.preventDefault();
				const form = e.currentTarget;
				onSubmit(encodeAnswers(prompt, questions, questions.map((q, i) => answerOf(q, filledIn(form, nameOf(i))))));
			}}
		>
			{batch && (
				<div className="flex flex-col gap-1 pr-12">
					<div className="flex items-baseline gap-2">
						<span className="min-w-0 truncate text-xs font-medium">{prompt.question}</span>
						<QuestionnaireProgress className="shrink-0" />
					</div>
					{message && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{message}</p>}
				</div>
			)}
			{questions.map((q, i) => (
				<QuestionnaireItem key={i} className="min-h-0" name={nameOf(i)} required={mustAnswer(q)} multiple={q.method === "multiselect"}>
					<QuestionnaireTitle className={batch ? undefined : "pr-12"}>{q.title}</QuestionnaireTitle>
					{q.message && <QuestionnaireDescription className="whitespace-pre-wrap">{q.message}</QuestionnaireDescription>}
					{choicesOf(q).length > 0 && (
						// A long list scrolls in its own place, so that what is asked stays
						// over it and the way to send stays under it: everything from the
						// frame down to here may be squeezed (min-h-0), and this is the one
						// that gives. The edge it is given is room for the ring around the
						// choice the keys are on, which a scrolling box would otherwise cut.
						<QuestionnaireChoices className="-m-1 min-h-0 overflow-y-auto p-1">
							{choicesOf(q).map((choice, j) => (
								<QuestionnaireChoice key={j} value={String(j)}>
									{choice}
								</QuestionnaireChoice>
							))}
						</QuestionnaireChoices>
					)}
					{(q.method === "input" || q.other) && (
						<QuestionnaireInput
							aria-label={q.method === "input" ? q.title : "Another answer"}
							placeholder={q.method === "input" ? q.placeholder : "Another answer…"}
						/>
					)}
					<QuestionnaireError />
				</QuestionnaireItem>
			))}
			<QuestionnaireActions>
				<QuestionnairePrevious />
				{/* Several may be none of them, and that is an answer: it is said as one. */}
				<QuestionnaireSkip>{current?.method === "multiselect" ? "None" : "Skip"}</QuestionnaireSkip>
				<QuestionnaireNext />
				<QuestionnaireSubmit />
			</QuestionnaireActions>
		</Questionnaire>
	);
}

/**
 * A page of text to change and hand back, which an extension may ask for
 * (extensionUI.ts). Not the form's: its line is one line, and Enter there
 * moves on, where here it is a new line.
 */
function Page({ prompt, onSubmit }: { prompt: PromptRequest; onSubmit: (answer: string) => void }) {
	const box = useRef<HTMLTextAreaElement>(null);
	// The text is there to be added to, and a box given the focus starts at its top.
	useEffect(() => {
		box.current?.setSelectionRange(box.current.value.length, box.current.value.length);
	}, []);
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit(box.current?.value ?? "");
			}}
		>
			<label htmlFor={`${prompt.id}-page`} className="pr-12 text-sm leading-snug font-medium">
				{prompt.question}
			</label>
			<Textarea
				ref={box}
				id={`${prompt.id}-page`}
				defaultValue={prompt.defaultValue}
				className="max-h-60"
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
						e.preventDefault();
						e.currentTarget.form!.requestSubmit();
					}
				}}
			/>
			<div className="flex items-center justify-end gap-2">
				<span className="text-xs text-muted-foreground">{MOD}↵</span>
				<Button type="submit" size="sm">
					Submit
				</Button>
			</div>
		</form>
	);
}
