/**
 * firstSpec.ts, given the page to act on: what the shell kept is taken, the
 * stores are what is seen, and each step is sent — until the line has gone,
 * to the agent or to the message box.
 *
 * Apart from firstSpec.ts because ws.ts opens the socket as it is imported,
 * and the rules are tested without one.
 */
import { toast } from "sonner";

import { type First, type Progress, type Seen, SPEC, START, next, specCommand } from "./firstSpec";
import { commandsStore, configStore, providersStore, restoredStore } from "./serverState";
import { getConnection, subscribe } from "./store";
import { send } from "./ws";

/** How long a thing asked of the server is waited for before it is given up. */
const PATIENCE_MS = 10_000;

const shell = (window as { pi?: { workspaces?: { first?: (folder: string) => Promise<First | null> } } }).pi?.workspaces;

function seen(): Seen {
	const providers = providersStore.get();
	return {
		online: getConnection() === "open",
		signedIn: providers ? providers.some((provider) => provider.signedIn) : null,
		hasCommand: commandsStore.get().some((command) => command.name === SPEC),
		config: configStore.get(),
	};
}

/**
 * Called once as the page starts. Nothing is taken from the shell until the
 * server has been heard from: what is taken is gone from there, so it is
 * taken when there is a page able to do something with it.
 */
export function wireFirstSpec(): void {
	if (!shell?.first) return;
	let first: First | null = null;
	let asking = false;
	let progress: Progress = START;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const stops: (() => void)[] = [];

	const end = () => {
		if (timer !== null) clearTimeout(timer);
		for (const stop of stops.splice(0)) stop();
	};
	const patience = () => {
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			advance(true);
		}, PATIENCE_MS);
	};
	const leave = (text: string, why: string) => {
		restoredStore.set(text);
		toast.info(why);
		end();
	};

	function advance(late = false): void {
		if (!first) {
			const now = seen();
			if (asking || !now.online || !now.config || now.signedIn === null) return;
			asking = true;
			// For this page's own workspace, by name: the server said which.
			shell!.first!(configStore.get()!.folder).then(
				(taken) => {
					if (!taken) return end();
					first = taken;
					advance();
				},
				() => end(),
			);
			return;
		}
		const went = next(first, seen(), progress, late);
		progress = went.progress;
		const step = went.step;
		if (step.do === "wait") {
			if (timer === null) patience();
		} else if (step.do === "set") {
			// Not sent, the socket having just closed: asked again when it is back.
			if (send(step.message)) patience();
			else progress = START;
		} else if (step.do === "send") {
			if (!send(step.message)) return leave(specCommand(first.line), "Not connected. Your line is in the message box.");
			if (step.warning) toast.warning(step.warning);
			end();
		} else leave(step.text, step.why);
	}

	for (const store of [configStore, providersStore, commandsStore]) stops.push(store.subscribe(() => advance()));
	stops.push(subscribe(() => advance()));
	advance();
}
