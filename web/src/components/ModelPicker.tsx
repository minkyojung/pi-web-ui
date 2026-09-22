import { useEffect } from "react";

import type { ModelInfo } from "../types";
import { openSettings } from "../settingsOpen";
import { send } from "../ws";
import { ModelMenu } from "./ModelMenu";

const MAC = navigator.userAgent.includes("Mac");
const heldForSlot = (e: KeyboardEvent) => (MAC ? e.ctrlKey && e.metaKey : e.ctrlKey && e.altKey);

export { levelLabel } from "./ModelMenu";

/**
 * The model and how hard it thinks, in one place, because they are one choice.
 *
 * They were two buttons and the thinking level was one value for the session,
 * so changing model silently re-used the last level. pi keeps a level per
 * model; this shows each model with its own beside it, and choosing one brings
 * its level with it.
 *
 * The list is the loadout rather than everything pi offers — fifty-odd entries
 * is a list you search, not one you pick from, and searching belongs in
 * settings. What is on the list, and in what order, is settings.json's
 * `loadout`; until something is there it is the newest GPT models. See
 * models.ts.
 *
 * The menu itself is ModelMenu, which knows nothing of the session; this is
 * the session's use of it — a choice is sent to pi, and the keys that reach a
 * model by its place or step the effort work here.
 */
export function ModelPicker({
	model,
	level,
	models,
	notice,
	disabled,
	id = "model",
	onChoose,
}: {
	model: string | null;
	/** The level to show with the model, when it is not the model's own — a choice made here, not pi's setting. */
	level?: string | null;
	models: ModelInfo[];
	notice?: string;
	disabled: boolean;
	id?: string;
	/**
	 * Given, the picker reports a choice instead of setting the session: what
	 * is chosen is the caller's to keep and to use, and nothing is sent to pi.
	 * The keys that set the session are off in this mode, since they would
	 * set it. Without it, the picker is the session's, as at the message box.
	 */
	onChoose?: (choice: { model: string; level: string }) => void;
}) {
	const found = models.find((m) => m.key === model) ?? null;
	const current = found && level ? { ...found, level } : found;
	const levels = current?.levels ?? [];
	const idle = disabled || models.length === 0;

	useEffect(() => {
		if (idle || onChoose) return;
		const onKey = (e: KeyboardEvent) => {
			if (heldForSlot(e) && e.code.startsWith("Digit")) {
				const slot = models[Number(e.code.slice(5)) - 1];
				if (!slot) return;
				e.preventDefault();
				if (slot.key !== model) send({ type: "set_model", model: slot.key });
				return;
			}
			// Round the model's own ladder, which is shorter for some models than
			// the one the menu draws.
			if (e.key === "/" && e.shiftKey && (e.metaKey || e.ctrlKey) && current && levels.length) {
				e.preventDefault();
				send({ type: "set_thinking", level: levels[(levels.indexOf(current.level) + 1) % levels.length] });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [idle, onChoose, models, model, current, levels]);

	return (
		<ModelMenu
			id={id}
			model={model}
			level={level}
			models={models}
			notice={notice}
			disabled={disabled}
			shortcuts={!onChoose}
			onAccounts={() => openSettings("Accounts")}
			onChoose={onChoose ?? ((choice, changed) => send(changed === "model" ? { type: "set_model", model: choice.model } : { type: "set_thinking", level: choice.level }))}
		/>
	);
}
