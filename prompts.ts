/**
 * Answering an extension's questions from the browser.
 *
 * The dashboard extension replaces pi's dialog methods with its own PromptBus
 * and sends every question to a dashboard app nobody here has open, where it
 * waits out a five-minute timeout. The same bridge exposes a hook for other
 * packages to register as an answerer — `prompt:register-adapter`, documented
 * in its architecture notes and used by its sibling flows plugin — so this is
 * one: it forwards each question to the browser, and hands the first reply
 * back to the bus.
 *
 * Nothing here touches conversation.js. A question is not a conversation item.
 */
import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { PromptRequest, ServerMsg } from "./protocol.ts";

export interface PromptResponse {
	id: string;
	answer?: string;
	cancelled?: boolean;
	source: string;
}

/** What the bus calls on an adapter, and what it injects into one. */
interface PromptAdapter {
	name: string;
	priority: number;
	onRequest(prompt: PromptRequest): object;
	onResponse(response: PromptResponse): void;
	onCancel(id: string): void;
	setRespond(fn: (response: PromptResponse) => void): void;
	setCancel(fn: (id: string) => void): void;
}

const SOURCE = "pi-web-ui";

/** How a question of ours ended without an answer: the person closed it, or the session went. */
export class Cancelled extends Error {
	constructor() {
		super("The question was not answered.");
		this.name = "Cancelled";
	}
}

/** A question of ours, waiting on a browser. */
interface Waiting {
	resolve: (answer: string) => void;
	reject: (reason: Cancelled) => void;
}

export function createPromptBridge(broadcast: (payload: ServerMsg) => void) {
	const pending = new Map<string, PromptRequest>();
	// Our own questions, by id — as opposed to the dashboard's, which are
	// settled through its bus. One or the other has an entry, never both.
	const waiting = new Map<string, Waiting>();
	let respond: ((response: PromptResponse) => void) | null = null;
	let cancel: ((id: string) => void) | null = null;

	// The one place a question leaves the map. Whether a tab answered, another
	// adapter did, or the bus timed it out, every browser hears the same thing.
	const dismiss = (id: string, extra: { answer?: string; cancelled: boolean }) => {
		if (pending.delete(id)) broadcast({ type: "prompt_dismiss", id, ...extra });
	};

	// A question of ours is settled here and nowhere else: the browser's reply,
	// a cancel from the browser, or everything at once before an abort.
	const settle = (id: string, answer: string | null) => {
		const waits = waiting.get(id);
		if (!waits) return false;
		waiting.delete(id);
		if (answer === null) {
			dismiss(id, { cancelled: true });
			waits.reject(new Cancelled());
		} else {
			dismiss(id, { answer, cancelled: false });
			waits.resolve(answer);
		}
		return true;
	};

	const adapter: PromptAdapter = {
		name: SOURCE,
		// Lower runs first. The dashboard's own fallback adapter sits at 9999.
		priority: 100,
		onRequest(prompt) {
			pending.set(prompt.id, prompt);
			broadcast({ type: "prompt_request", prompt });
			// An empty claim: participate, but let the bus render nothing of ours
			// on the dashboard side.
			return {};
		},
		onResponse(response) {
			dismiss(response.id, { answer: response.answer, cancelled: response.cancelled === true });
		},
		onCancel(id) {
			dismiss(id, { cancelled: true });
		},
		setRespond(fn) {
			respond = fn;
		},
		setCancel(fn) {
			cancel = fn;
		},
	};

	return {
		/**
		 * Ask the browser, and wait. The answer is a string in the shape the
		 * card sends — see promptAnswer.ts in the client — or a Cancelled
		 * rejection when the person closed it or the session went. No timeout:
		 * the card stays on screen, and an abort or a switch clears it.
		 */
		ask(question: Omit<PromptRequest, "id" | "pipeline">): Promise<string> {
			const prompt: PromptRequest = { ...question, id: crypto.randomUUID(), pipeline: SOURCE };
			pending.set(prompt.id, prompt);
			broadcast({ type: "prompt_request", prompt });
			return new Promise<string>((resolve, reject) => waiting.set(prompt.id, { resolve, reject }));
		},

		/**
		 * Call after every bindExtensions(): a replaced session reloads the
		 * extension, which builds a new bus with a new hook. Returns false when
		 * the hook never injected a responder — the extension is absent or has
		 * changed — so the caller can say so instead of letting questions time
		 * out silently. The reset comes first so the answer is per-bind.
		 */
		register(bus: EventBus): boolean {
			respond = null;
			cancel = null;
			bus.emit("prompt:register-adapter", adapter);
			return respond !== null;
		},

		/**
		 * A browser's reply. Cancelling goes through the bus's own cancel, which
		 * resolves the tool the way its decoders expect, rather than a response
		 * flagged cancelled. A reply to a question already settled — by another
		 * tab, or by the timeout — finds nothing in the map and is dropped.
		 */
		answer(id: string, answer: string | undefined, cancelled: boolean): void {
			if (!pending.has(id)) return;
			if (waiting.has(id)) {
				if (cancelled) settle(id, null);
				else if (answer !== undefined) settle(id, answer);
				return;
			}
			if (cancelled) cancel?.(id);
			else if (answer !== undefined) respond?.({ id, answer, source: SOURCE });
		},

		/** Before an abort: a tool waiting on a question cannot be aborted around. */
		cancelAll(): void {
			for (const id of [...pending.keys()]) {
				if (!settle(id, null)) cancel?.(id);
			}
		},

		/** For a tab that connects while questions are open. */
		open(): PromptRequest[] {
			return [...pending.values()];
		},
	};
}
