import { Trash2Icon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { configStore } from "../serverState";
import { send } from "../ws";
import {
	Queue,
	QueueItem,
	QueueItemContent,
	QueueItemIndicator,
	QueueList,
	QueueSection,
	QueueSectionContent,
	QueueSectionLabel,
	QueueSectionTrigger,
} from "./ai-elements/queue";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * Messages typed during a run, which pi is holding until it can take them. It
 * used to be a count in the settings bar, which proved they existed and nothing
 * else — not what you had written, and no way to take it back.
 *
 * Sits on the composer because that is where they were typed and where they
 * come back to. The server already sends the text of both queues and re-sends
 * it on pi's queue_update, so this needs nothing kept in sync.
 *
 * Clearing is all of them at once, which is the only queue edit pi offers; see
 * the clear_queue case in server.ts for why the per-message version would be a
 * worse thing than no version.
 */
export function QueuedMessages() {
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	// Steering first: it is delivered at the next turn boundary, follow-ups only
	// once the run is done, so this is the order they will actually be sent in.
	const queued = [
		...(config?.queued.steering ?? []).map((text) => ({ text, steer: true })),
		...(config?.queued.followUp ?? []).map((text) => ({ text, steer: false })),
	];
	if (queued.length === 0) return null;

	return (
		// Inset and sitting on the composer rather than flush with it, so it reads
		// as a drawer the input is pulling out from under itself.
		<Queue className="mx-2 rounded-b-none border-b-0 pb-4">
			<QueueSection>
				<div className="flex items-center gap-1">
					<QueueSectionTrigger className="flex-1">
						<QueueSectionLabel count={queued.length} label="queued" />
					</QueueSectionTrigger>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="size-7 text-muted-foreground"
								onClick={() => send({ type: "clear_queue" })}
							>
								<Trash2Icon className="size-4" />
								<span className="sr-only">Clear the queue</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent side="top">Clear the queue — the text goes back in the box</TooltipContent>
					</Tooltip>
				</div>
				<QueueSectionContent>
					<QueueList>
						{queued.map((item, i) => (
							<QueueItem key={`${i}-${item.text}`} className="flex-row items-baseline gap-2">
								<QueueItemIndicator />
								<QueueItemContent>{item.text}</QueueItemContent>
								{/* Only the ones that will cut the run short need saying. */}
								{item.steer && <span className="shrink-0 text-[10px] text-muted-foreground">steer</span>}
							</QueueItem>
						))}
					</QueueList>
				</QueueSectionContent>
			</QueueSection>
		</Queue>
	);
}
