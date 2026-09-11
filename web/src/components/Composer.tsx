import { useEffect, useRef, useSyncExternalStore } from "react";

import { PencilIcon, X } from "lucide-react";

import { appendRestored } from "../queue";
import { flushSaves } from "../saves";
import { askingAgainStore, configStore, promptsStore, restoredStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { ContextPopover } from "./ContextPopover";
import { ModelSelect } from "./ModelSelect";
import { QueuedMessages } from "./QueuedMessages";
import { ThinkingSelect } from "./ThinkingSelect";
import { ToolModes } from "./ToolModes";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "./ai-elements/prompt-input";

const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";

/**
 * Send the text and empty the box, whichever way it was sent.
 *
 * The open note rides along as its path, not its body: pi has `read`, so a
 * line naming the file does the same work for one line of tokens. Whatever is
 * typed there and not yet written goes out on the same socket ahead of this,
 * so pi reads what is on screen — see saves.ts.
 */
function submit(form: HTMLFormElement, text: string, behavior: "followUp" | "steer", note: string | null) {
	const trimmed = text.trim();
	if (!trimmed) return;
	flushSaves();
	// Where an earlier question is being asked again, its place in the session
	// tree rides along: the server moves the leaf to just before it and sends
	// this from there, so the two are alternatives rather than a sequence.
	const asking = askingAgainStore.get();
	send({
		type: "prompt",
		text: note ? `Open in the editor: ${note}\n\n${trimmed}` : trimmed,
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
				onSubmit={(message, event) => submit(event.currentTarget, message.text, "followUp", note)}
			>
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
								submit(e.currentTarget.form!, e.currentTarget.value, "steer", note);
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

