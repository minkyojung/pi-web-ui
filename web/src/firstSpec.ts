/**
 * Starting the spec a workspace was made for: the line typed in the new spec
 * dialog, sent here as `/spec` — the same command, sent for the person, as
 * approving and running are (specApprove.ts, specRun.ts).
 *
 * The dialog was on another page. The shell held the line, and the model and
 * effort chosen beside it, while the window was loaded again from this
 * workspace's server, and gives them to this page once (electron/firstSpec.js).
 *
 * `/spec` runs in the session that is open, and takes a line and nothing
 * else — a model could not be told from the words of the line. So the
 * session is put on the model first, the way the message box's picker does
 * it, and then at the effort, and then the line is sent. One step at a time,
 * each seen to have happened in what the server says next: the server takes
 * each message as its own event, so three sent together may be done in any
 * order.
 *
 * The line is never lost. Where it cannot be sent — nobody is signed in, the
 * spec commands are not here — it is put in the message box instead, as
 * typed, for the person to send when they can. A model or an effort that
 * cannot be had does not stop the spec: it starts on what the session is on,
 * and says so.
 *
 * Pure. What is sent, and when it has waited too long, is wire's — below.
 */
import type { ClientMsg, ModelInfo } from "../../protocol.ts";

/** What the shell kept — see electron/firstSpec.js. */
export interface First {
	line: string;
	model: string | null;
	effort: string | null;
}

/** What the page knows now, of what this reads. `null` is "the server has not said". */
export interface Seen {
	online: boolean;
	signedIn: boolean | null;
	hasCommand: boolean;
	config: { model: string | null; models: ModelInfo[]; isStreaming: boolean; isCompacting: boolean } | null;
}

/** How far each setting has got: not asked for, asked for, and how it ended. */
type Setting = "todo" | "asked" | "done" | "failed";
export interface Progress {
	model: Setting;
	effort: Setting;
}
export const START: Progress = { model: "todo", effort: "todo" };

export type Step =
	| { do: "wait" }
	| { do: "set"; message: ClientMsg }
	| { do: "send"; message: ClientMsg; warning: string | null }
	| { do: "draft"; text: string; why: string };

/** Its name on pi's list of commands, which is how the window knows it is there. */
export const SPEC = "spec";

/** What the person would type. */
export const specCommand = (line: string): string => `/${SPEC} ${line}`;

/** And what the box sends when they do — see Composer.tsx. */
export const specMessage = (line: string): ClientMsg => ({ type: "prompt", text: specCommand(line), command: true, behavior: "followUp" });

/**
 * The next thing to do, and how far that leaves things. `late` says what was
 * waited for has not come in the time given it: a setting asked for is given
 * up, and anything else waited for leaves the line in the box.
 */
export function next(first: First, seen: Seen, progress: Progress, late = false): { step: Step; progress: Progress } {
	const draft = (why: string): { step: Step; progress: Progress } => ({ step: { do: "draft", text: specCommand(first.line), why }, progress });
	const wait = (why: string) => (late ? draft(why) : { step: { do: "wait" } as Step, progress });

	if (!seen.online || !seen.config || seen.signedIn === null) return wait("The workspace did not answer in time. Your line is in the message box.");
	if (!seen.signedIn) return draft("Sign in, then send the line waiting in the message box.");
	if (!seen.hasCommand) return wait("Spec commands are not loaded here. Your line is in the message box.");
	if (seen.config.isStreaming || seen.config.isCompacting) return wait("The agent is working. Your line is in the message box.");

	let { model, effort } = progress;
	if (model === "todo" || model === "asked") {
		if (!first.model || first.model === seen.config.model) model = "done";
		else if (model === "asked") {
			if (!late) return { step: { do: "wait" }, progress };
			model = "failed";
		} else if (!seen.config.models.some((m) => m.key === first.model)) model = "failed";
		else return { step: { do: "set", message: { type: "set_model", model: first.model } }, progress: { model: "asked", effort } };
	}

	// The effort is the model's: asked of another model it would be that
	// model's level that was set, so it is left alone when the model failed.
	const current = seen.config.models.find((m) => m.key === seen.config?.model) ?? null;
	if (effort === "todo" || effort === "asked") {
		if (!first.effort || current?.level === first.effort) effort = "done";
		else if (model === "failed" || !current?.levels.includes(first.effort)) effort = "failed";
		else if (effort === "asked") {
			if (!late) return { step: { do: "wait" }, progress: { model, effort } };
			effort = "failed";
		} else return { step: { do: "set", message: { type: "set_thinking", level: first.effort } }, progress: { model, effort: "asked" } };
	}

	const on = current ? `${current.name}${current.level ? ` at ${current.level}` : ""}` : "the model it opened on";
	const missed = model === "failed" ? first.model : effort === "failed" ? first.effort : null;
	return {
		step: { do: "send", message: specMessage(first.line), warning: missed ? `${missed} could not be used for this spec — it starts on ${on}.` : null },
		progress: { model, effort },
	};
}
