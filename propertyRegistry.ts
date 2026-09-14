/**
 * The chosen property types, kept beside the notes.
 *
 * `.pi/properties.json`, in the shape Obsidian keeps its own
 * (`{ "types": { "pages": "number" } }`): only what someone chose, never a
 * guess, so the file stays a list of decisions and a note's own values do
 * the rest. Read once at startup and written whole on every change; it is
 * small, and nothing else writes it. Unreadable is the same as absent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { coerceRegistry, isReserved, keyOf, type PropertyType, type Registry } from "./propertyTypes.ts";

export const REGISTRY_PATH = ".pi/properties.json";

export class PropertyRegistry {
	private types: Registry = {};
	private file: string;

	constructor(root: string) {
		this.file = join(root, REGISTRY_PATH);
	}

	load(): void {
		if (!existsSync(this.file)) return;
		try {
			this.types = coerceRegistry(JSON.parse(readFileSync(this.file, "utf8")));
		} catch {
			this.types = {};
		}
	}

	/** What has been chosen, for the browser to draw by. */
	all(): Registry {
		return { ...this.types };
	}

	/**
	 * Choose a type for a name, or with null let it be guessed again. A
	 * reserved name is refused: false, and nothing written.
	 */
	set(name: string, type: PropertyType | null): boolean {
		const key = keyOf(name);
		if (!key || isReserved(key)) return false;
		if (type === null) delete this.types[key];
		else this.types[key] = type;
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify({ types: this.types }, null, 2) + "\n");
		return true;
	}
}
