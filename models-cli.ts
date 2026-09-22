/**
 * The models a spec can be started on, for a screen with no server behind
 * it: the first screen, which the shell serves itself, has no folder for a
 * server and so no `config` to read the list off. This asks pi the same
 * question the server does (server.ts modelInfo, catalog) and prints the
 * answer once — the loadout, each model with the level pi would put it on,
 * and the model pi opens a session on — for the shell to hand to that page.
 *
 *   ELECTRON_RUN_AS_NODE=1 <electron> dist-server/models.mjs
 */
import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

import { clampLevel, loadoutOf, supportedLevels } from "./models.ts";
import type { ModelInfo } from "./protocol.ts";
import { readSettings } from "./settings.ts";

const runtime = await ModelRuntime.create();
const settings = SettingsManager.create(process.cwd(), getAgentDir());
const available = runtime.getAvailableSnapshot();
const keys = available.map((m) => `${m.provider}/${m.id}`);
const preferred = settings.getDefaultModel() ?? null;
const model = preferred && keys.includes(preferred) ? preferred : null;
const models: ModelInfo[] = loadoutOf(readSettings().loadout, keys, model).flatMap((key) => {
	const m = available.find((entry) => `${entry.provider}/${entry.id}` === key);
	if (!m) return [];
	const levels = supportedLevels(m);
	return [{ key, name: m.name, levels, level: clampLevel(levels, settings.getModelThinkingLevel(m.provider, m.id) ?? settings.getDefaultThinkingLevel() ?? "medium") }];
});
process.stdout.write(JSON.stringify({ model: model ?? models[0]?.key ?? null, models }));
process.exit(0);
