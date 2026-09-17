/**
 * Signing in to a provider, from the browser.
 *
 * pi owns the whole of it — which providers there are, what each one asks for,
 * where the credential is kept — and its `login()` knows nothing of a screen:
 * it takes an object with `prompt` and `notify` and asks through those, which
 * is how its own terminal dialog is drawn (LoginDialogComponent). This is that
 * object with a socket behind it, after prompts.ts: what pi asks goes out to
 * every tab as login_prompt, the first answer from any tab settles it, and
 * what pi says along the way — the URL to open, a code to wait for, progress —
 * goes out as login_event. When pi is done, or gives up, login_done says so.
 *
 * One sign-in at a time. Two at once would be two dialogs asking over each
 * other for a thing one person does one of.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { LoginPrompt, ServerMsg } from "./protocol.ts";

// pi's AuthInteraction, AuthPrompt and AuthEvent live in @earendil-works/pi-ai,
// which is not re-exported (see THINKING_LEVELS in models.ts); read off the
// method that takes them instead, so they are the ones the runtime actually
// wants.
type AuthInteraction = Parameters<ModelRuntime["login"]>[2];
type AuthPrompt = Parameters<AuthInteraction["prompt"]>[0];
type AuthEvent = Parameters<AuthInteraction["notify"]>[0];

/** How a question ended without an answer: the person closed it, or the sign-in was cancelled. */
export class LoginCancelled extends Error {
	constructor() {
		super("The sign-in was cancelled.");
		this.name = "LoginCancelled";
	}
}

interface Waiting {
	resolve: (value: string) => void;
	reject: (reason: LoginCancelled) => void;
}

interface Active {
	provider: string;
	controller: AbortController;
	waiting: Map<string, Waiting>;
	/** The question out now, for a tab that connects while it is. */
	open: LoginPrompt | null;
}

/** pi's AuthPrompt as it goes over the wire: the same fields, less the signal. */
function wire(id: string, provider: string, prompt: AuthPrompt): LoginPrompt {
	const { signal: _signal, ...rest } = prompt;
	return { id, provider, ...rest } as LoginPrompt;
}

export function createLoginBridge(
	broadcast: (payload: ServerMsg) => void,
	run: (provider: string, method: "oauth" | "api_key", interaction: AuthInteraction) => Promise<unknown>,
	/** Something to open a URL with, where there is one — the shell, in the desktop app. */
	openUrl: ((url: string) => void) | null,
) {
	let active: Active | null = null;

	const settle = (id: string, value: string | null) => {
		const waits = active?.waiting.get(id);
		if (!active || !waits) return;
		active.waiting.delete(id);
		if (active.open?.id === id) active.open = null;
		if (value === null) waits.reject(new LoginCancelled());
		else waits.resolve(value);
	};

	return {
		/**
		 * Begin, and see it through. Resolves once pi has stored the credential
		 * or given up, with which; either way every tab hears login_done, and
		 * what went wrong is in it rather than thrown, since the tabs are who
		 * it is for. Refused while another sign-in is under way.
		 */
		async start(provider: string, method: "oauth" | "api_key"): Promise<boolean> {
			if (active) throw new Error(`Already signing in to ${active.provider}.`);
			const controller = new AbortController();
			const me: Active = { provider, controller, waiting: new Map(), open: null };
			active = me;
			const interaction: AuthInteraction = {
				signal: controller.signal,
				prompt(prompt) {
					const id = crypto.randomUUID();
					const out = wire(id, provider, prompt);
					me.open = out;
					broadcast({ type: "login_prompt", prompt: out });
					return new Promise<string>((resolve, reject) => {
						me.waiting.set(id, { resolve, reject });
						// pi withdraws a question it no longer needs — a code typed by
						// hand, once the callback has arrived — and the card should go
						// with it rather than wait for a keystroke nobody owes it.
						prompt.signal?.addEventListener("abort", () => {
							if (me.waiting.has(id)) {
								settle(id, null);
								broadcast({ type: "login_prompt_dismiss", id });
							}
						});
					});
				},
				notify(event: AuthEvent) {
					if (event.type === "auth_url") openUrl?.(event.url);
					broadcast({ type: "login_event", provider, event });
				},
			};
			try {
				await run(provider, method, interaction);
				broadcast({ type: "login_done", provider, ok: true });
				return true;
			} catch (err) {
				const cancelled = controller.signal.aborted || err instanceof LoginCancelled;
				broadcast({
					type: "login_done",
					provider,
					ok: false,
					error: cancelled ? undefined : err instanceof Error ? err.message : String(err),
				});
				return false;
			} finally {
				for (const id of [...me.waiting.keys()]) settle(id, null);
				if (active === me) active = null;
			}
		},

		/** A tab's answer to a question. One to a question already settled finds nothing waiting and is dropped. */
		answer(id: string, value: string | undefined, cancelled: boolean): void {
			if (cancelled) this.cancel();
			else if (value !== undefined) settle(id, value);
		},

		/** Stop the sign-in under way, if there is one. pi sees its signal abort; every tab hears login_done. */
		cancel(): void {
			active?.controller.abort();
		},

		/** For a tab that connects mid-sign-in: the question waiting, if one is. */
		open(): LoginPrompt | null {
			return active?.open ?? null;
		},

		/** Which provider is being signed in to, or null. */
		busy(): string | null {
			return active?.provider ?? null;
		},
	};
}
