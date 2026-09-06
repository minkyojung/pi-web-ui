import { useEffect, useRef, useSyncExternalStore } from "react";

import { configStore, promptsStore, restoredStore } from "../serverState";
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

/** Send the text and empty the box, whichever way it was sent. */
function submit(form: HTMLFormElement, text: string, behavior: "followUp" | "steer") {
	const trimmed = text.trim();
	if (!trimmed) return;
	send({ type: "prompt", text: trimmed, behavior });
	form.reset();
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
export function Composer() {
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
		const existing = box.current.value;
		box.current.value = existing ? `${existing}\n\n${restored}` : restored;
		box.current.focus();
		restoredStore.set(null);
	}, [restored]);

	return (
		<div className="border-t p-3">
			<QueuedMessages />
			<PromptInput
				onSubmit={(message, event) => submit(event.currentTarget, message.text, "followUp")}
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
								submit(e.currentTarget.form!, e.currentTarget.value, "steer");
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
