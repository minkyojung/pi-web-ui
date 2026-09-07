/**
 * A tool call in one line, for the row of a collapsed tool.
 *
 * Without it a run reads as `grep`, `read`, `read`, `bash` — the tool names and
 * nothing about what they touched, so following a conversation means opening
 * each card and reading its arguments as JSON.
 *
 * The shapes below are pi 0.84's built-in tool schemas (core/tools/*), plus this
 * project's own `set_gist`. A tool that is not listed, or whose arguments do not
 * look the way they should, returns null and the card keeps the plain tool name
 * it has today: a header is not worth guessing at, and a schema that changes
 * under us should degrade rather than lie.
 *
 * Tool names are used as they arrive. pi does carry a human label for each tool
 * (`ToolDefinition.label`), but `getAllTools()` does not include it and the
 * server does not send it, so translating names here would be inventing a
 * second set of labels that could drift from pi's.
 */

/** A non-empty string argument, or null. */
function str(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/**
 * The last two segments of a path. A bare file name is ambiguous across a tree
 * with an `index.ts` in every folder; the full path does not fit.
 */
function shortPath(value: unknown): string | null {
	const path = str(value);
	if (!path) return null;
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.length > 2 ? parts.slice(-2).join("/") : path;
}

/** What this call did, without the tool's name. */
function detailOf(name: string, args: Record<string, unknown>): string | null {
	switch (name) {
		case "read":
		case "write":
			return shortPath(args.path);

		case "edit": {
			const path = shortPath(args.path);
			if (!path) return null;
			// One edit is the common case and saying so adds nothing; several is
			// the thing worth knowing before opening the card.
			const edits = Array.isArray(args.edits) ? args.edits.length : 0;
			return edits > 1 ? `${path} · ${edits} edits` : path;
		}

		// The one tool whose path is optional, and whose default is worth showing.
		case "ls":
			return shortPath(args.path) ?? ".";

		case "find":
			return str(args.pattern);

		// Quoted, because a search pattern is a literal and often full of
		// punctuation that would otherwise read as part of the sentence.
		case "grep": {
			const pattern = str(args.pattern);
			return pattern ? `"${pattern}"` : null;
		}

		case "bash":
		case "powershell":
			return str(args.command);

		case "set_gist":
			return typeof args.id === "number" ? `#${args.id}` : null;

		default:
			return null;
	}
}

/**
 * What a tool call touched, in a few words, or null to say nothing.
 *
 * Returned without the tool's name: the row renders the two differently, and
 * without a length cap, because the row truncates to whatever width it has —
 * a cap here would cut a line short of the space it actually had. Newlines are
 * collapsed, since a command written across three lines still gets one.
 *
 * @param name  the tool's name, as pi sent it
 * @param args  the arguments, unvalidated — this is called on whatever arrived
 */
export function toolDetail(name: string | undefined, args: unknown): string | null {
	if (!name) return null;
	// Anything that is not an object indexes to undefined, which every rule
	// treats as a missing argument, so a surprising shape falls through to null.
	const detail = detailOf(name, (args ?? {}) as Record<string, unknown>);
	return detail ? detail.replace(/\s+/g, " ").trim() : null;
}
