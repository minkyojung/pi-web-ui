import { useSyncExternalStore } from "react";

import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";

/** Group by provider; the list runs to dozens of entries. */
function byProvider(models: string[]): [string, string[]][] {
	const groups = new Map<string, string[]>();
	for (const key of models) {
		const provider = key.slice(0, key.indexOf("/"));
		if (!groups.has(provider)) groups.set(provider, []);
		groups.get(provider)!.push(key);
	}
	return [...groups];
}

/**
 * A native <select> that looks like a shadcn ghost button.
 *
 * Native for the picking: fifty-odd entries across provider groups are found
 * by typing the first letters, which a portalled listbox does not do. But a
 * native select sizes itself to its widest option and has no hover state, so
 * the visible part is a ghost Button — text-fit, accent on hover — and the
 * real select lies over it invisibly, taking the clicks and the keyboard.
 */
export function ModelSelect({ model, models }: { model: string | null; models: string[] }) {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const label = model ? model.slice(model.indexOf("/") + 1) : "model";

	return (
		<span className="group relative inline-flex">
			{/* The pointer is over the invisible select, never over this button, so the
			    button's own hover: never fires; the wrapper's does, hence group-hover:. */}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-7 px-2 text-xs group-hover:bg-accent group-hover:text-accent-foreground dark:group-hover:bg-accent/50"
				disabled={!online}
				tabIndex={-1}
			>
				{label}
			</Button>
			<select
				id="model"
				aria-label="Model"
				className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
				disabled={!online}
				value={model ?? ""}
				onChange={(e) => send({ type: "set_model", model: e.target.value })}
			>
				{byProvider(models).map(([provider, keys]) => (
					<optgroup key={provider} label={provider}>
						{keys.map((key) => (
							<option key={key} value={key}>
								{key.slice(provider.length + 1)}
							</option>
						))}
					</optgroup>
				))}
			</select>
		</span>
	);
}
