import { useSyncExternalStore } from "react";

import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { NativeSelect } from "./ui/native-select";

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

export function ModelSelect({ model, models, className }: { model: string | null; models: string[]; className?: string }) {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	return (
		<NativeSelect
			id="model"
			className={className ?? "max-w-56"}
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
		</NativeSelect>
	);
}
