/**
 * Naming a conversation that nobody has named.
 *
 * A session carries a name pi keeps for it, and until something puts one there
 * the list and the header read by the conversation's first message, cut short.
 * That is a fair stand-in and a poor name: the first message is how someone
 * opened, not what the conversation turned out to be about.
 *
 * So once the first exchange is over, the cheapest model that can be reached
 * is shown it and asked for three words. It happens in a session of its own
 * which is never written to disk, because the one place a naming session must
 * not turn up is the list of conversations it exists to label.
 *
 * Nothing here is load-bearing. A name that does not arrive leaves the first
 * message standing in, which is what was there before — so every failure is
 * silent, and the cost of being wrong is a name a person can change.
 */
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
	type AgentSessionEvent,
	type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

import { textOf } from "./conversation.js";

/** As many words as a header shows at a glance. The model is asked for no more. */
export const WORDS = 3;

/** As much of a message as says what it is about. The rest is not worth sending. */
const SHOWN = 2000;

/** What a short exchange costs on a model, which is all "cheap" has to mean here. */
const price = (m: Priced) => m.cost.input + m.cost.output;

interface Priced {
	cost: { input: number; output: number };
}

/**
 * The cheapest model there is a credential for.
 *
 * Not the one the conversation is on: that may be the most capable model in
 * the list, and three words do not need it. Not a model named in a constant
 * either — whoever runs this has their own providers, and a hard-coded id is
 * a feature that silently does nothing for everyone it was not chosen for.
 */
export function cheapest<M extends Priced>(models: readonly M[]): M | undefined {
	let best: M | undefined;
	for (const model of models) if (!best || price(model) < price(best)) best = model;
	return best;
}

/**
 * The name in what the model said, or nothing.
 *
 * Asked for three words a model usually answers with three words. The rest of
 * the time it wraps them in quotes, ends them with a full stop, or sets them
 * in bold. Only the first line is read, and only the first three words of it:
 * a long answer is a model that did not understand, and its first three words
 * are as good a name as anything else it said.
 */
export function nameFrom(reply: string): string | undefined {
	const line = reply
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!line) return undefined;
	const name = line
		.replace(/[*_`"'“”‘’]/g, "")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, WORDS)
		.join(" ")
		.replace(/[.,;:!?\s]+$/, "");
	return name || undefined;
}

/** The first exchange, and what to make of it, as the naming model is shown it. */
export function asking(question: string, answer: string): string {
	const cut = (text: string) => (text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text);
	return [
		`Name this conversation in at most ${WORDS} words.`,
		"Answer with the name alone: no quotes, no full stop, nothing before it.",
		"Name what it is about, the way a person titles a note.",
		"",
		"Asked:",
		cut(question),
		"",
		"Answered:",
		cut(answer),
	].join("\n");
}

/** As long as a name is worth waiting for. Nothing is shown while it runs. */
const PATIENCE_MS = 30_000;

/**
 * Ask the cheapest model for a name, in a session that is thrown away.
 *
 * The session is built without extensions, skills, context files or tools:
 * none of them have anything to say about three words, and each of them would
 * be read off disk and paid for in tokens.
 */
export async function askForName(options: {
	cwd: string;
	agentDir: string;
	modelRuntime: ModelRuntime;
	models: readonly Priced[];
	question: string;
	answer: string;
}): Promise<string | undefined> {
	const model = cheapest(options.models);
	if (!model) return undefined;

	const services = await createAgentSessionServices({
		cwd: options.cwd,
		agentDir: options.agentDir,
		modelRuntime: options.modelRuntime,
		resourceLoaderOptions: {
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPrompt: "You name things briefly and plainly.",
		},
	});
	const { session } = await createAgentSessionFromServices({
		services,
		// Never written down. A session file here would appear in the list of
		// conversations, which is the one place this must not show up.
		sessionManager: SessionManager.inMemory(options.cwd),
		model: model as Parameters<typeof createAgentSessionFromServices>[0]["model"],
		noTools: "all",
	});

	try {
		await settled(session, asking(options.question, options.answer));
		// Backwards for the reply: a run can end on something other than a
		// message, and what was said is the last thing that was said.
		for (let i = session.messages.length - 1; i >= 0; i--) {
			const message = session.messages[i];
			if (message.role === "assistant") return nameFrom(textOf(message.content));
		}
		return undefined;
	} finally {
		session.dispose();
	}
}

/** Say it, and wait for the run to end — or give up on it. */
function settled(session: { prompt(text: string): Promise<void>; subscribe(fn: (e: AgentSessionEvent) => void): () => void }, text: string): Promise<void> {
	return new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(patience);
			unsubscribe();
			resolve();
		};
		const patience = setTimeout(finish, PATIENCE_MS);
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "agent_settled") finish();
		});
		// A refused prompt — no credential, a model gone — settles nothing, so
		// the wait has to end on the throw as well as on the event.
		session.prompt(text).catch(finish);
	});
}
