import { BrainIcon } from "lucide-react";

import { MessageResponse } from "./ai-elements/message";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

/**
 * What the model thought before it answered.
 *
 * pi streams this — `thinking_delta`, alongside the text deltas — and until now
 * the reducer had no case for it, so a session with thinking on paid for
 * reasoning tokens and showed nothing for them. The gap was visible in the
 * gallery as a scenario that played and left the screen unchanged.
 *
 * A row like a tool call, for the same reason: a run is mostly things the model
 * did on the way to an answer, and each of them wants one line until asked for
 * more. The thought's own first words are the preview — the beginning of it
 * stays put as the rest streams in behind the truncation, so a row that appears
 * does not then move.
 *
 * The registry's `reasoning` component was the obvious thing to use here and
 * does not fit: it opens itself when the stream starts and closes itself a
 * second after it ends, which is the flicker this column was just cleared of.
 * What is left of it after taking that out is a collapsible and a markdown
 * body, which is what this is.
 */
export function ThinkingRow({ text }: { text: string }) {
	// One line, however the model laid it out. The row truncates to its width,
	// so the thought is not cut to a length it might have had room for.
	const preview = text.replace(/\s+/g, " ").trim();

	return (
		<Collapsible className="-my-1">
			<CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left font-normal hover:bg-muted/60">
				<BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="shrink-0 text-sm font-normal text-foreground/80">Thinking</span>
				{preview && <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{preview}</span>}
			</CollapsibleTrigger>

			<CollapsibleContent className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in">
				{/* Markdown, because a thought is written the way an answer is —
				    lists, code, the occasional heading — and read as prose. Held a
				    shade back from the answer's own text: it is what led to the
				    answer, not the answer. */}
				<div className="mt-1 mb-2 ml-[0.7rem] border-l pl-3 text-sm text-muted-foreground">
					<MessageResponse>{text}</MessageResponse>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
