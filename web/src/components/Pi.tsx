import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";

import { configStore, promptsStore } from "../serverState";
import { getItems, subscribe } from "../store";
import { send } from "../ws";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { PanelHeader } from "./PanelHeader";
import { Question } from "./Question";
import { RawView } from "./RawView";

/** Nothing in the window has the focus: it is on the page itself. */
const focusIsNowhere = () => !document.activeElement || document.activeElement === document.body;
/** The focus is where it should be left: on something being written in, or in a dialog over the window. */
const focusIsHeld = () => {
	const el = document.activeElement;
	return el instanceof HTMLElement && (el.isContentEditable || el.matches("input, textarea, select") || !!el.closest("[role=dialog]"));
};

/**
 * The foot of pi's column: the box to write in, or, while the agent is
 * waiting on an answer, the question in its place — one at a time, the one
 * that has waited longest first.
 *
 * A question is not a conversation item (prompts.ts), and it used to be drawn
 * under the conversation all the same, over a box that was still there to
 * write in. But while it is open there is one thing to say to the agent, and
 * that is the answer: so it is where the writing is done, and the raw view,
 * which has no conversation to put it under, shows it too.
 *
 * The box is put out of sight and not taken down. What it holds that is not
 * text — an image pasted in, a file on its way into the folder whose path is
 * still to be written where the cursor was — is held in it and nowhere else,
 * and would go with it.
 *
 * The focus goes to the question unless something else is being written in:
 * a question that comes up while a note is being typed does not take the keys
 * away from it, and the strip at the foot of the window says the agent is
 * waiting. From the box itself it does go — that is the same place. Subscribes
 * on its own, so a question does not re-render the conversation above it.
 */
function Foot({ children }: { children: ReactNode }) {
	const prompts = useSyncExternalStore(promptsStore.subscribe, promptsStore.get);
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const prompt = prompts[0];
	const box = useRef<HTMLDivElement>(null);
	// Read before the box is hidden, which is when the browser takes the focus
	// off whatever is in it; the question reads this once, as it comes up.
	const here = !focusIsHeld() || (box.current?.contains(document.activeElement) ?? false);
	// And back to the box when the last question goes, if nothing else has the
	// focus: it went with the question, and the box is where it came from.
	const asking = useRef(false);
	useEffect(() => {
		if (asking.current && !prompt && focusIsNowhere()) box.current?.querySelector("textarea")?.focus();
		asking.current = !!prompt;
	}, [prompt]);

	return (
		<>
			{prompt && (
				<div className="flex max-h-[60%] shrink-0 flex-col p-3">
					<Question
						key={prompt.id}
						prompt={prompt}
						streaming={config?.isStreaming ?? false}
						autoFocus={here}
						onAnswer={(answer) => send({ type: "prompt_response", id: prompt.id, answer })}
						onCancel={() => send({ type: "prompt_response", id: prompt.id, cancelled: true })}
						onStop={() => send({ type: "abort" })}
					/>
				</div>
			)}
			<div ref={box} hidden={!!prompt}>
				{children}
			</div>
		</>
	);
}

/**
 * pi, whole: the session's name, the conversation, and the box to write in.
 *
 * The name stays in here rather than going up to the row over the columns.
 * That row is the note tabs' — it runs across pi as well as the note, since
 * the tabs want more width than the note alone has — and which session is
 * open is pi's own business, not something true of the pair of them.
 */
export function Pi({ front, raw }: { front: string | null; raw: boolean }) {
	const items = useSyncExternalStore(subscribe, getItems);
	return (
		<>
			<PanelHeader />
			{/* The two views used to be swapped by a body.raw class, which has no
			    home in a utility stylesheet — and only one was ever read. */}
			{raw ? <RawView /> : <Conversation items={items} />}
			<Foot>
				<Composer front={front} />
			</Foot>
		</>
	);
}
