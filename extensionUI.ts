/**
 * What an extension may ask of the screen, in a server that has no screen.
 *
 * pi hands every extension a `ctx.ui`, and its own headless host — RPC mode —
 * binds one that forwards the four questions a dialog can be (select,
 * confirm, input, editor) and a notification, and answers the rest with
 * nothing: a widget, a footer, a status line are places on a terminal, and
 * this is not one. This is that binding, with the questions going where
 * ask_user's already go (prompts.ts) so they come up as the same card, and
 * a notification going into the conversation, since that is where a person
 * reading Octave would look.
 *
 * A dialog the extension abandons — its signal fires, its timeout runs out —
 * is closed on every tab and answered with the same default pi's RPC host
 * gives: nothing for a choice or a line, no for a confirm.
 */
import { type ExtensionUIContext, type ExtensionUIDialogOptions, Theme } from "@earendil-works/pi-coding-agent";

import type { PromptRequest, ServerMsg } from "./protocol.ts";
import { Cancelled, type createPromptBridge } from "./prompts.ts";

type Prompts = ReturnType<typeof createPromptBridge>;
type Question = Omit<PromptRequest, "id" | "pipeline">;

/**
 * The theme an extension may colour its terminal output with, which is then
 * thrown away with the widget it was for. pi's own instance is behind its
 * package boundary, so this is one of pi's Theme with every colour the
 * terminal's default — a string comes back with the text still in it, which
 * is all that is asked of it. The names are pi's ThemeColor and ThemeBg.
 */
const PLAIN = 7;
const plainTheme = () => {
	const fg = ["accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text", "thinkingText", "userMessageText", "customMessageText", "customMessageLabel", "toolTitle", "toolOutput", "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet", "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation", "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "bashMode"] as const;
	const bg = ["selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"] as const;
	const all = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, PLAIN])) as Record<K, number>;
	return new Theme(all(fg), all(bg), "256color", { name: "plain" });
};

export function extensionUI(prompts: Prompts, broadcast: (msg: ServerMsg) => void): ExtensionUIContext {
	// The answer, or the default when the person closed the card or the
	// extension stopped waiting — the one way a question ends without one.
	const ask = async <T>(question: Question, opts: ExtensionUIDialogOptions | undefined, fallback: T, read: (answer: string) => T): Promise<T> => {
		try {
			return read(await prompts.ask(question, opts));
		} catch (err) {
			if (err instanceof Cancelled) return fallback;
			throw err;
		}
	};
	const message = (text: string | undefined) => (text ? { metadata: { message: text } } : {});

	return {
		select: (title, options, opts) => ask({ type: "select", question: title, options }, opts, undefined, (a) => a),
		confirm: (title, text, opts) => ask({ type: "confirm", question: title, ...message(text) }, opts, false, (a) => a === "true"),
		input: (title, placeholder, opts) =>
			ask({ type: "input", question: title, ...(placeholder ? { defaultValue: placeholder } : {}) }, opts, undefined, (a) => a),
		editor: (title, prefill) =>
			ask({ type: "editor", question: title, ...(prefill ? { defaultValue: prefill } : {}) }, undefined, undefined, (a) => a),
		notify(text, type) {
			if (type === "error") broadcast({ type: "error", message: text });
			else broadcast({ type: "notice", text });
		},
		// The rest is the terminal's, and there is none. Each answers as pi's
		// RPC host does: nothing happens, and nothing is promised.
		onTerminalInput: () => () => {},
		addAutocompleteProvider: () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => undefined as never,
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme: plainTheme(),
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "Octave has no terminal theme to switch" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}
