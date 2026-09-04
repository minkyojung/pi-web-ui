import { send } from "../ws";

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

export function ModelSelect({ model, models }: { model: string | null; models: string[] }) {
	return (
		<select id="model" value={model ?? ""} onChange={(e) => send({ type: "set_model", model: e.target.value })}>
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
	);
}
