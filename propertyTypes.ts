/**
 * What kind of thing a property holds — and where that is decided, which
 * is not in the note.
 *
 * YAML says nothing about it: `date: 2024-01-01` is a string to the parser
 * (properties.ts), and whether it is a date is a fact about the *name*
 * `date`, the same in every note of the vault. So a type belongs to a name,
 * vault-wide, as Obsidian has it: chosen once and kept in a small file
 * beside the notes (.pi/properties.json — see propertyRegistry.ts), or,
 * for a name nobody has chosen for, guessed from the value in front of us.
 * `tags` and `aliases` are what they are and cannot be chosen otherwise.
 *
 * A type says how a value is shown and edited, and what shape it is written
 * in; it never rewrites a value on its own. A value that does not fit its
 * type is a mismatch to be shown, not corrected — the note is the truth.
 *
 * Shared by both ends: the server keeps the file, the panel draws by it.
 */

export const PROPERTY_TYPES = ["text", "list", "number", "checkbox", "date", "datetime", "tags"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** The type chosen for a name, by the name as written lower-case: `Date` and `date` are one property. */
export type Registry = Record<string, PropertyType>;

/** The names that are what they are. */
const RESERVED: Registry = { tags: "tags", aliases: "list" };

export const isPropertyType = (v: unknown): v is PropertyType => PROPERTY_TYPES.includes(v as PropertyType);

/** The key a name is looked up by. */
export const keyOf = (name: string) => name.trim().toLowerCase();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/**
 * A guess from a value, for a name nobody has chosen for: what the value
 * plainly is. Nothing (null) says nothing, and is text.
 */
export function inferType(value: unknown): PropertyType {
	if (typeof value === "boolean") return "checkbox";
	if (typeof value === "number") return "number";
	if (Array.isArray(value)) return "list";
	if (typeof value === "string") {
		if (DATE.test(value)) return "date";
		if (DATETIME.test(value)) return "datetime";
	}
	return "text";
}

/** The type of `name` holding `value`: reserved, else chosen, else guessed. */
export function typeOf(name: string, value: unknown, registry: Registry): PropertyType {
	const key = keyOf(name);
	return RESERVED[key] ?? registry[key] ?? inferType(value);
}

/** Whether `name` is one whose type is not up for choosing. */
export const isReserved = (name: string) => keyOf(name) in RESERVED;

/**
 * Whether a value is of a type, as written: a number for number, true or
 * false for checkbox, a `YYYY-MM-DD` string for date, a list of names for
 * list and tags. Nothing fits anything — an empty property is not wrong,
 * it is empty. Text takes any one value, and a list of one.
 */
export function fits(type: PropertyType, value: unknown): boolean {
	if (value === null || value === undefined) return true;
	switch (type) {
		case "text":
			return typeof value !== "object" || (Array.isArray(value) && value.length <= 1);
		case "number":
			return typeof value === "number";
		case "checkbox":
			return typeof value === "boolean";
		case "date":
			return typeof value === "string" && DATE.test(value);
		case "datetime":
			return typeof value === "string" && (DATETIME.test(value) || DATE.test(value));
		case "list":
		case "tags":
			return typeof value === "string" || typeof value === "number" || (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number"));
	}
}

/**
 * Anything at all into a registry: the file is hand-editable and the
 * browser is across a socket, so each entry is read on its own and a bad
 * one is dropped rather than taking the rest with it. Reserved names are
 * not kept — they are not the file's to say.
 */
export function coerceRegistry(raw: unknown): Registry {
	const out: Registry = {};
	const types = (raw as { types?: unknown } | null)?.types;
	if (!types || typeof types !== "object") return out;
	for (const [name, type] of Object.entries(types as Record<string, unknown>)) {
		const key = keyOf(name);
		if (key && !(key in RESERVED) && isPropertyType(type)) out[key] = type;
	}
	return out;
}
