import { useRef, useSyncExternalStore } from "react";

import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "./ai-elements/prompt-input";
import { NativeSelect } from "./ui/native-select";

/**
 * Where you write to pi.
 *
 * At the bottom, because the conversation grows downwards and reading the
 * answer should not mean scrolling back up to reply. The textarea is
 * uncontrolled — the component reads it out of the form on submit — so typing
 * does not re-render the conversation, and it knows to leave Enter alone while
 * an IME is composing, which a plain input does not.
 */
export function Composer() {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const behavior = useRef<HTMLSelectElement>(null);

	return (
		<div className="border-t p-3">
			<PromptInput
				onSubmit={(message) => {
					const text = message.text.trim();
					if (!text) return;
					send({ type: "prompt", text, behavior: behavior.current?.value });
				}}
			>
				<PromptInputBody>
					{/* The component asks for four lines of empty box; one is enough until
					    there is something to show, and it grows from there. */}
					<PromptInputTextarea className="min-h-9" placeholder="pi에게 보낼 말" disabled={!online} />
				</PromptInputBody>
				<PromptInputFooter>
					<PromptInputTools>
						<NativeSelect
							id="behavior"
							ref={behavior}
							className="w-36 border-none shadow-none"
							title="작업 중일 때 보낸 말을 어떻게 처리할지"
						>
							<option value="followUp">기다렸다 보내기</option>
							<option value="steer">바로 끼어들기</option>
						</NativeSelect>
					</PromptInputTools>
					<PromptInputSubmit disabled={!online} />
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}
