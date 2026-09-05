import { memo, useState } from "react";

import { type AnswerValue, type BatchQuestion, batchQuestions, encodeAnswer, encodeBatchAnswer } from "../promptAnswer";
import type { PromptRequest } from "../types";
import { send } from "../ws";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";

/**
 * A question the agent asked, answered here instead of in a dashboard nobody
 * has open. Not a conversation item: it arrives on its own message, lives in
 * its own store, and goes away on prompt_dismiss — whichever tab answered.
 *
 * Memoized on the prompt object; every input lives in local state so typing
 * re-renders this card and nothing else.
 */
export const PromptCard = memo(function PromptCard({ prompt }: { prompt: PromptRequest }) {
	const [sent, setSent] = useState(false);
	const message = typeof prompt.metadata?.message === "string" ? prompt.metadata.message : undefined;
	// A local so the branch below narrows it; `prompt.type` would not.
	const type = prompt.type;

	const reply = (answer: string) => {
		setSent(true);
		send({ type: "prompt_response", id: prompt.id, answer });
	};
	const cancel = () => {
		setSent(true);
		send({ type: "prompt_response", id: prompt.id, cancelled: true });
	};

	return (
		<div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
			<div className="mb-2 flex items-center gap-2">
				<Badge variant="secondary">ask_user</Badge>
				<span className="font-medium">{prompt.question}</span>
			</div>
			{message && <p className="mb-3 text-sm text-muted-foreground whitespace-pre-wrap">{message}</p>}

			<fieldset disabled={sent} className="flex flex-col gap-2">
				{type === "batch" ? (
					<BatchBody prompt={prompt} onSubmit={reply} />
				) : (
					<SingleBody prompt={prompt} onSubmit={(value) => reply(encodeAnswer(type, value))} />
				)}
			</fieldset>

			<div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
				{sent ? (
					<span>Sent</span>
				) : (
					<Button type="button" variant="ghost" size="sm" onClick={cancel}>
						Cancel
					</Button>
				)}
			</div>
		</div>
	);
});

/** One control for one question. `value` is whatever the control holds. */
function SingleBody({ prompt, onSubmit }: { prompt: PromptRequest; onSubmit: (value: AnswerValue) => void }) {
	const [value, setValue] = useState<AnswerValue>(prompt.type === "multiselect" ? [] : (prompt.defaultValue ?? ""));

	switch (prompt.type) {
		case "select":
			return (
				<div className="flex flex-col gap-1.5">
					{(prompt.options ?? []).map((option) => (
						<Button
							key={option}
							type="button"
							variant="outline"
							className="justify-start"
							onClick={() => onSubmit(option)}
						>
							{option}
						</Button>
					))}
				</div>
			);

		case "confirm":
			return (
				<div className="flex gap-2">
					<Button type="button" onClick={() => onSubmit(true)}>
						Yes
					</Button>
					<Button type="button" variant="outline" onClick={() => onSubmit(false)}>
						No
					</Button>
				</div>
			);

		case "multiselect": {
			const picked = Array.isArray(value) ? value : [];
			return (
				<>
					<OptionChecks id={prompt.id} options={prompt.options ?? []} picked={picked} onChange={setValue} />
					{/* Nothing picked is still an answer, and a different one from cancelling. */}
					<Button type="button" className="self-start" onClick={() => onSubmit(picked)}>
						Submit
					</Button>
				</>
			);
		}

		case "editor":
			return (
				<>
					<Textarea
						value={typeof value === "string" ? value : ""}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
								e.preventDefault();
								onSubmit(value);
							}
						}}
						autoFocus
					/>
					<div className="flex items-center gap-2">
						<Button type="button" size="sm" onClick={() => onSubmit(value)}>
							Submit
						</Button>
						<span className="text-xs text-muted-foreground">{MOD}↵ to submit</span>
					</div>
				</>
			);

		default:
			return (
				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						onSubmit(value);
					}}
				>
					<Input
						value={typeof value === "string" ? value : ""}
						placeholder={prompt.defaultValue}
						onChange={(e) => setValue(e.target.value)}
						autoFocus
					/>
					<Button type="submit">Submit</Button>
				</form>
			);
	}
}

/** Every sub-question in one card with one submit; stepping through them one at a time adds state for nothing. */
function BatchBody({ prompt, onSubmit }: { prompt: PromptRequest; onSubmit: (encoded: string) => void }) {
	const questions = batchQuestions(prompt);
	const [values, setValues] = useState<AnswerValue[]>(() =>
		questions.map((q) => (q.method === "confirm" ? false : q.method === "multiselect" ? [] : "")),
	);
	const setAt = (i: number, v: AnswerValue) => setValues((prev) => prev.map((x, j) => (j === i ? v : x)));

	if (questions.length === 0) {
		return <p className="text-sm text-muted-foreground">This question arrived in a shape the card cannot show.</p>;
	}

	return (
		<>
			{questions.map((q, i) => (
				<div key={i} className="flex flex-col gap-1.5 rounded-md border p-2">
					<div className="text-sm font-medium">{q.title}</div>
					{q.message && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{q.message}</p>}
					<BatchControl id={`${prompt.id}-${i}`} question={q} value={values[i]} onChange={(v) => setAt(i, v)} />
				</div>
			))}
			<Button type="button" className="self-start" onClick={() => onSubmit(encodeBatchAnswer(questions, values))}>
				Submit
			</Button>
		</>
	);
}

function BatchControl({
	id,
	question,
	value,
	onChange,
}: {
	id: string;
	question: BatchQuestion;
	value: AnswerValue;
	onChange: (v: AnswerValue) => void;
}) {
	switch (question.method) {
		case "confirm":
			return (
				<div className="flex gap-2">
					<Button type="button" size="sm" variant={value === true ? "default" : "outline"} onClick={() => onChange(true)}>
						Yes
					</Button>
					<Button type="button" size="sm" variant={value === false ? "default" : "outline"} onClick={() => onChange(false)}>
						No
					</Button>
				</div>
			);
		case "select":
			return (
				<div className="flex flex-wrap gap-1.5">
					{(question.options ?? []).map((option) => (
						<Button
							key={option}
							type="button"
							size="sm"
							variant={value === option ? "default" : "outline"}
							onClick={() => onChange(option)}
						>
							{option}
						</Button>
					))}
				</div>
			);
		case "multiselect":
			return (
				<OptionChecks
					id={id}
					options={question.options ?? []}
					picked={Array.isArray(value) ? value : []}
					onChange={onChange}
				/>
			);
		default:
			return (
				<Input
					value={typeof value === "string" ? value : ""}
					placeholder={question.placeholder}
					onChange={(e) => onChange(e.target.value)}
				/>
			);
	}
}

function OptionChecks({
	id,
	options,
	picked,
	onChange,
}: {
	id: string;
	options: string[];
	picked: string[];
	onChange: (next: string[]) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			{options.map((option) => (
				<Label key={option} htmlFor={`${id}-${option}`} className="gap-2 font-normal">
					<Checkbox
						id={`${id}-${option}`}
						checked={picked.includes(option)}
						onCheckedChange={(on) =>
							onChange(on === true ? [...picked, option] : picked.filter((p) => p !== option))
						}
					/>
					{option}
				</Label>
			))}
		</div>
	);
}
