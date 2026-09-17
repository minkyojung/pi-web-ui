/**
 * pi's questions to the person, answered in the browser.
 *
 * A question comes from the ask_user tool (askUser.ts) and goes out to every
 * tab as prompt_request; the first reply from any tab settles it, and every
 * tab hears prompt_dismiss so the card goes away everywhere. Nothing waits
 * it out: the card stays until it is answered, closed, or the session it
 * belonged to is aborted or replaced, which clears every open question.
 *
 * Nothing here touches conversation.js. A question is not a conversation item.
 */
import type { PromptRequest, ServerMsg } from "./protocol.ts";

const SOURCE = "octave";

/** How a question ended without an answer: the person closed it, or the session went. */
export class Cancelled extends Error {
	constructor() {
		super("The question was not answered.");
		this.name = "Cancelled";
	}
}

/** A question waiting on a browser. */
interface Waiting {
	resolve: (answer: string) => void;
	reject: (reason: Cancelled) => void;
}

export function createPromptBridge(broadcast: (payload: ServerMsg) => void) {
	const pending = new Map<string, PromptRequest>();
	const waiting = new Map<string, Waiting>();

	// The one place a question is settled: the browser's reply, a cancel from
	// the browser, or everything at once before an abort. Whichever it was,
	// every browser hears the same thing.
	const settle = (id: string, answer: string | null) => {
		const waits = waiting.get(id);
		if (!waits) return;
		waiting.delete(id);
		pending.delete(id);
		if (answer === null) {
			broadcast({ type: "prompt_dismiss", id, cancelled: true });
			waits.reject(new Cancelled());
		} else {
			broadcast({ type: "prompt_dismiss", id, answer, cancelled: false });
			waits.resolve(answer);
		}
	};

	return {
		/**
		 * Ask the browser, and wait. The answer is a string in the shape the
		 * card sends — see promptAnswer.ts in the client — or a Cancelled
		 * rejection when the person closed it or the session went.
		 */
		ask(question: Omit<PromptRequest, "id" | "pipeline">, opts?: { signal?: AbortSignal; timeout?: number }): Promise<string> {
			const prompt: PromptRequest = { ...question, id: crypto.randomUUID(), pipeline: SOURCE };
			// An asker that has stopped waiting — its signal fired, its time ran
			// out — is answered as a close is, and every tab sees the card go.
			if (opts?.signal?.aborted) return Promise.reject(new Cancelled());
			pending.set(prompt.id, prompt);
			broadcast({ type: "prompt_request", prompt });
			const asked = new Promise<string>((resolve, reject) => waiting.set(prompt.id, { resolve, reject }));
			const close = () => settle(prompt.id, null);
			opts?.signal?.addEventListener("abort", close, { once: true });
			const timer = opts?.timeout ? setTimeout(close, opts.timeout) : undefined;
			return asked.finally(() => {
				opts?.signal?.removeEventListener("abort", close);
				if (timer) clearTimeout(timer);
			});
		},

		/**
		 * A browser's reply. A reply to a question already settled — by
		 * another tab, or by an abort — finds nothing waiting and is dropped.
		 */
		answer(id: string, answer: string | undefined, cancelled: boolean): void {
			if (cancelled) settle(id, null);
			else if (answer !== undefined) settle(id, answer);
		},

		/** Before an abort: a tool waiting on a question cannot be aborted around. */
		cancelAll(): void {
			for (const id of [...waiting.keys()]) settle(id, null);
		},

		/** For a tab that connects while questions are open. */
		open(): PromptRequest[] {
			return [...pending.values()];
		},
	};
}
