import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { PencilIcon, TextQuoteIcon, X } from "lucide-react";

import { type Chosen as ChosenWords, chosenStore } from "../chosen";
import { appendRestored } from "../queue";
import { flushSaves } from "../saves";
import { askingAgainStore, configStore, promptsStore, restoredStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Badge } from "./ui/badge";
import { ContextPopover } from "./ContextPopover";
import { ModelSelect } from "./ModelSelect";
import { QueuedMessages } from "./QueuedMessages";
import { ThinkingSelect } from "./ThinkingSelect";
import { ToolModes } from "./ToolModes";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputHeader,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "./ai-elements/prompt-input";

const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";

/**
 * Send the text and empty the box, whichever way it was sent.
 *
 * The open note rides along as its path, beside the message and not in it:
 * the server tells pi for the turn, so the path is never part of what was
 * said, kept, compacted, or asked again later when it may be another note.
 * Whatever is typed there and not yet written goes out on the same socket
 * ahead of this, so pi reads what is on screen — see saves.ts.
 */
function submit(
	form: HTMLFormElement,
	text: string,
	behavior: "followUp" | "steer",
	note: string | null,
	chosen: ChosenWords | null,
) {
	const trimmed = text.trim();
	if (!trimmed) return;
	flushSaves();
	// Where an earlier question is being asked again, its place in the session
	// tree rides along: the server moves the leaf to just before it and sends
	// this from there, so the two are alternatives rather than a sequence.
	const asking = askingAgainStore.get();
	send({
		type: "prompt",
		text: trimmed,
		...(note ? { note } : {}),
		// What was chosen in the note, for this turn: pi is told what the
		// question is about, and the words stay out of the message itself.
		...(chosen && chosen.path === note ? { chosen: chosen.text } : {}),
		behavior,
		...(asking ? { entryId: asking.entryId } : {}),
	});
	askingAgainStore.set(null);
	form.reset();
}

/**
 * A note that what is in the box will replace an earlier question rather than
 * follow it, and the way to change your mind. Dropping it leaves the text
 * where it is: it was copied in, and taking it back out is not what cancelling
 * means here.
 */
function AskingAgain() {
	const asking = useSyncExternalStore(askingAgainStore.subscribe, askingAgainStore.get);
	if (!asking) return null;

	return (
		<div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
			<PencilIcon className="size-3 shrink-0" />
			<span className="min-w-0 flex-1 truncate">Asking again: {asking.text}</span>
			<button
				type="button"
				onClick={() => askingAgainStore.set(null)}
				aria-label="Send as a new question instead"
				className="rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground"
			>
				<X className="size-3" />
			</button>
		</div>
	);
}

/**
 * What is chosen in the note, above the box, so that a question can be about
 * it without being made to quote it.
 *
 * It appears by being chosen and goes by being unchosen — no key, no button to
 * attach with. Dropping it with the × leaves the words chosen on screen and
 * only stops them riding along, until something else is chosen.
 */
function Chosen({ chosen, onDrop }: { chosen: ChosenWords | null; onDrop: () => void }) {
	if (!chosen) return null;

	return (
		<PromptInputHeader id="chosen">
			<Badge variant="secondary" className="max-w-full gap-1 font-normal" title={chosen.text}>
				<TextQuoteIcon className="size-3 shrink-0" />
				<span className="min-w-0 truncate">{chosen.text}</span>
				<button
					type="button"
					onClick={onDrop}
					aria-label="Do not send the chosen words"
					className="rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground"
				>
					<X className="size-3" />
				</button>
			</Badge>
		</PromptInputHeader>
	);
}

/**
 * Where you write to pi.
 *
 * What to do with a message typed mid-run used to be a dropdown, which asked
 * for the decision permanently and before there was anything to decide about.
 * Nobody does it that way: ChatGPT will not take the message at all, and the
 * agents that will — Cursor, Claude Code — make it a gesture on the key you
 * press. So it is one here too, and only while a run is going.
 */
export function Composer({ note }: { note: string | null }) {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const streaming = config?.isStreaming ?? false;
	const asking = useSyncExternalStore(promptsStore.subscribe, promptsStore.get).length > 0;
	// What the editor points at, unless this one has been dropped with the ×.
	const chosen = useSyncExternalStore(chosenStore.subscribe, chosenStore.get);
	const [dropped, setDropped] = useState<string | null>(null);
	const pointing = chosen && chosen.path === note && chosen.text !== dropped ? chosen : null;

	// Text a cleared queue handed back. The box is uncontrolled — PromptInput
	// reads it out of the form on submit — so it is written directly, appended
	// rather than assigned so it cannot overwrite something half-typed.
	const box = useRef<HTMLTextAreaElement>(null);
	const restored = useSyncExternalStore(restoredStore.subscribe, restoredStore.get);
	useEffect(() => {
		if (!restored || !box.current) return;
		box.current.value = appendRestored(box.current.value, restored);
		box.current.focus();
		restoredStore.set(null);
	}, [restored]);

	return (
		<div className="border-t p-3">
			<QueuedMessages />
			<AskingAgain />
			<PromptInput
				onSubmit={(message, event) => submit(event.currentTarget, message.text, "followUp", note, pointing)}
			>
				<Chosen chosen={pointing} onDrop={() => setDropped(pointing?.text ?? null)} />
				<PromptInputBody>
					{/* The component asks for four lines of empty box; one is enough until
					    there is something to show, and it grows from there. */}
					<PromptInputTextarea
						ref={box}
						className="min-h-9"
						placeholder="Message pi"
						disabled={!online}
						onKeyDown={(e) => {
							// Steering is delivered at the next turn boundary — after the
							// current turn's tool calls, before the next model call — so it
							// cuts a tool-using run short. Enter alone queues instead.
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
								e.preventDefault();
								submit(e.currentTarget.form!, e.currentTarget.value, "steer", note, pointing);
							}
						}}
					/>
				</PromptInputBody>
				<PromptInputFooter>
					<PromptInputTools>
						{/* Chosen per message, so it sits with the message. Native: fifty-odd
						    entries in provider groups are picked by typing the first letters. */}
						{config && (
							<>
								<ModelSelect model={config.model} models={config.models} />
								<ThinkingSelect level={config.thinkingLevel} levels={config.thinkingLevels} disabled={!online} />
								<ToolModes
									tools={config.tools}
									active={config.activeTools}
									disabled={!online}
									onSetTools={(names) => send({ type: "set_tools", names })}
								/>
							</>
						)}
						{asking ? (
							<span className="px-1 text-xs text-amber-600 dark:text-amber-500">
								pi is waiting for your answer above
							</span>
						) : (
							streaming && (
								<span className="px-1 text-xs text-muted-foreground">
									Enter to queue · {MOD}↵ to steer
								</span>
							)
						)}
					</PromptInputTools>
					<span className="flex items-center gap-1">
						<ContextPopover />
						{/* Becomes a stop button while a run streams, which is where the
						    settings bar's own stop button went. */}
						<PromptInputSubmit
							disabled={!online}
							status={streaming ? "streaming" : "ready"}
							onStop={() => send({ type: "abort" })}
						/>
					</span>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}

