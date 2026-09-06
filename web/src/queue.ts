/**
 * The two rules about queued messages that are worth being sure of: the order
 * they are shown in, and what happens to their text when the queue is cleared.
 * Pure, because the second one can lose what someone typed.
 */

export interface QueuedMessages {
	steering: string[];
	followUp: string[];
}

export interface QueuedMessage {
	text: string;
	/** Delivered at the next turn boundary, cutting the run short. */
	steer: boolean;
}

/**
 * Steering first: it arrives at the next turn boundary, follow-ups only once
 * the run is done. This is the order pi will send them, so it is the order to
 * show them in.
 */
export function queuedInOrder(queued: QueuedMessages | undefined): QueuedMessage[] {
	if (!queued) return [];
	return [
		...queued.steering.map((text) => ({ text, steer: true })),
		...queued.followUp.map((text) => ({ text, steer: false })),
	];
}

/**
 * What a clear hands back, as one block of text. Blank entries are dropped
 * rather than joined, so clearing an empty queue does not put two newlines in
 * the box; null when there is nothing to put back at all.
 */
export function clearedText(queued: QueuedMessages): string | null {
	const messages = queuedInOrder(queued)
		.map((m) => m.text)
		.filter((text) => text.trim() !== "");
	return messages.length ? messages.join("\n\n") : null;
}

/**
 * Put restored text in the box without destroying what is already there.
 * Someone can type while a run goes, queue it, keep typing, then clear — and
 * the half-written line still in the box is not ours to throw away.
 */
export function appendRestored(existing: string, restored: string): string {
	return existing.trim() === "" ? restored : `${existing}\n\n${restored}`;
}
