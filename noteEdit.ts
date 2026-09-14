/**
 * The one door pi writes a note by.
 *
 * pi's own `edit` and `write` put bytes on disk and tell nobody. Everything
 * the app needs around a write of a note — refusing one made on a version the
 * person has since typed past, recording who wrote which words, telling the
 * tabs where the change fell — has to be bolted on afterwards, from the
 * outside, by reading the file again and guessing. So the note is taken out
 * of their reach (see guard.ts) and given its own pair: `note_edit` and
 * `note_write`, which are the editor's own save with pi's name on it.
 *
 * Their shapes are pi's, exactly — `{ path, edits: [{ oldText, newText }] }`
 * and `{ path, content }`. `edit` and `write` are still there for everything
 * that is not a note, so the model holds two near-identical pairs at once;
 * giving ours different parameter names would only teach it to send one
 * tool's arguments to the other.
 *
 * Matching is exact, where pi's edit tool falls back to a fuzzy match. Its
 * matcher is not part of the package's public surface, and a note is prose a
 * person wrote — the wrong paragraph silently replaced is worse here than a
 * refusal pi can read and retry.
 *
 * Inline, like guard.ts and recorder.ts, and bound per session with them.
 */
import { type Static, Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { propertiesOf, removeProperty, setProperty, withProperties } from "./properties.ts";
import { keyOf } from "./propertyTypes.ts";
import { type Note, notePath, readNote, type WriteResult } from "./vault.ts";

/** The tools notes are written by. Nothing else may write one. */
export const NOTE_TOOLS = new Set(["note_edit", "note_write", "note_properties"]);

/**
 * Put pi's text into a note by the path every write takes: the file, then the
 * log, then the tabs. `had` is the note as it was read a moment ago, which is
 * both what the write is measured from and what it is refused over.
 */
export type WriteNote = (path: string, had: Note | null, text: string, sessionId: string, entryId?: string) => WriteResult;

type Edit = { oldText: string; newText: string };

/**
 * The note with every edit applied, or the reason it cannot be.
 *
 * Each `oldText` is matched against the note as it was, not against the
 * result of the edits before it — the rule pi states in its own guidelines
 * and the one the model has been taught. So each must be there exactly once,
 * and no two may cover the same words.
 */
export function applyEdits(text: string, edits: Edit[]): { ok: true; text: string } | { ok: false; reason: string } {
	const no = (reason: string) => ({ ok: false as const, reason });
	if (edits.length === 0) return no("edits must contain at least one replacement.");
	const matched: { of: number; at: number; length: number; newText: string }[] = [];
	for (const [of_, edit] of edits.entries()) {
		if (!edit.oldText) return no(`edits[${of_}].oldText is empty. It must be the exact text to replace.`);
		const at = text.indexOf(edit.oldText);
		if (at === -1) return no(`edits[${of_}].oldText is not in the note. Read it again and match its text exactly.`);
		if (text.indexOf(edit.oldText, at + 1) !== -1) {
			return no(`edits[${of_}].oldText appears more than once in the note. Include enough around it to be unique.`);
		}
		matched.push({ of: of_, at, length: edit.oldText.length, newText: edit.newText });
	}
	matched.sort((a, b) => a.at - b.at);
	for (let i = 1; i < matched.length; i++) {
		const previous = matched[i - 1];
		if (previous.at + previous.length > matched[i].at) {
			return no(`edits[${previous.of}] and edits[${matched[i].of}] cover the same words. Merge them into one edit.`);
		}
	}
	let out = "";
	let pos = 0;
	for (const match of matched) {
		out += text.slice(pos, match.at) + match.newText;
		pos = match.at + match.length;
	}
	return { ok: true, text: out + text.slice(pos) };
}

/** What a property may hold, as pi may send it: one value, or a list of them. Nothing nested — a property is a line, not a tree. */
export type PropertyValue = string | number | boolean | null | (string | number)[];

/** What one call changes: the properties it sets to a value, and the ones it takes away. */
export type PropertyChanges = { set: { name: string; value: PropertyValue }[]; remove: string[] };

/**
 * The note with its properties changed, or the reason they cannot be.
 *
 * The block is not text here. It is read as a document, the named properties
 * are set or taken away in it, and it is written back with only their lines
 * rewritten (properties.ts) — the others keep their comments, their quotes
 * and their order to the byte. What needs quoting is the library's to decide,
 * which is the whole reason this exists: a value with a colon or a `#` in it,
 * spliced in as text, would end the block early and take the note's tags and
 * links out of the index with it.
 *
 * Every change in a call is applied to the note as it was, and all of them or
 * none: a call that names one property twice is refused rather than guessed
 * at, and a block that cannot be read is left exactly as it is.
 */
export function applyProperties(text: string, changes: PropertyChanges): { ok: true; text: string } | { ok: false; reason: string } {
	const no = (reason: string) => ({ ok: false as const, reason });
	const { set, remove } = changes;
	if (set.length === 0 && remove.length === 0) return no("There is nothing to change: name a property in set[] or in remove[].");
	const seen = new Set<string>();
	for (const name of [...set.map((s) => s.name), ...remove]) {
		const key = keyOf(name);
		if (!key) return no("A property needs a name.");
		if (seen.has(key)) {
			return no(`${name} is named more than once in this call — once is enough, and set[] and remove[] cannot both have it. Say what it should end up as.`);
		}
		seen.add(key);
	}
	for (const { name, value } of set) {
		const flat = value === null || ["string", "number", "boolean"].includes(typeof value);
		const list = Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number");
		if (!flat && !list) return no(`${name} cannot hold that: a property holds a word, a number, true or false, nothing, or a list of words — never a nested value.`);
	}
	const edited = withProperties(text, (doc) => {
		for (const name of remove) removeProperty(doc, name);
		for (const { name, value } of set) setProperty(doc, name, value);
	});
	if (!edited.ok) return no("The properties could not be read, so nothing was written. Read the note and fix the block with note_edit — while it does not parse it is text.");
	return edited;
}

/**
 * What a model sent, as `edits` wants it.
 *
 * pi's own edit tool carries the same shim and says why: some models send
 * `edits` as a JSON string, and some send one edit where an array belongs.
 * Ours is held to the same schema, so it meets the same models.
 */
export function prepareEdits(args: unknown): unknown {
	if (!args || typeof args !== "object") return args;
	const input = { ...(args as Record<string, unknown>) };
	const single = (value: unknown): value is Edit =>
		!!value && typeof value === "object" && !Array.isArray(value) &&
		typeof (value as Edit).oldText === "string" && typeof (value as Edit).newText === "string";
	if (typeof input.edits === "string") {
		try {
			const parsed = JSON.parse(input.edits);
			if (Array.isArray(parsed)) input.edits = parsed;
			else if (single(parsed)) input.edits = [parsed];
		} catch {
			// Not JSON either; the schema will refuse it and say so.
		}
	} else if (single(input.edits)) {
		input.edits = [input.edits];
	}
	// An edit sent at the top level, where the array belongs.
	const { oldText, newText } = input as { oldText?: unknown; newText?: unknown };
	if (typeof oldText === "string" && typeof newText === "string") {
		input.edits = [...(Array.isArray(input.edits) ? input.edits : []), { oldText, newText }];
		delete input.oldText;
		delete input.newText;
	}
	return input;
}

const editSchema = Type.Object({
	path: Type.String({ description: "Path of the note, from the folder of notes" }),
	edits: Type.Array(
		Type.Object({
			oldText: Type.String({
				description: "Exact text for one targeted replacement. It must be unique in the note and must not overlap with any other edits[].oldText in the same call.",
			}),
			newText: Type.String({ description: "Replacement text for this targeted edit." }),
		}),
		{
			description: "One or more targeted replacements. Each edit is matched against the note as it is now, not incrementally. Do not include overlapping or nested edits.",
		},
	),
});

const propertiesSchema = Type.Object({
	path: Type.String({ description: "Path of the note, from the folder of notes" }),
	set: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String({ description: "The property's name, as it is written in the note or as it should be" }),
				value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null(), Type.Array(Type.Union([Type.String(), Type.Number()]))], {
					description: "What it should hold: a word, a number, true or false, null for an empty property, or a list of words. Send the whole list, not the part you are adding.",
				}),
			}),
			{ description: "Properties to give a value. One that is not in the note yet is added." },
		),
	),
	remove: Type.Optional(Type.Array(Type.String(), { description: "Names of properties to take out of the note altogether. To empty one instead, set it to null." })),
});

const writeSchema = Type.Object({
	path: Type.String({ description: "Path of the note, from the folder of notes" }),
	content: Type.String({ description: "The note's whole text" }),
});

/**
 * Why an edit that falls in the properties is refused.
 *
 * The soft version is in the guidelines; this is the one that holds when they
 * are forgotten, as guard.ts does for `edit` on a note. While the block can be
 * read it is not text: a quote or an indent out of place there is not a typo
 * to notice later but a note whose tags and links leave the index, and nothing
 * says so at the time. Broken already, it is text again and this steps aside —
 * which is the same pair the person is given, the panel while it reads and
 * "Edit the source" when it does not.
 */
export const IN_PROPERTIES = (path: string) =>
	`That edit falls in the properties at the top of ${path}, which are not plain text while they can be read: a misplaced quote or indent there takes the note's tags and links out of the index without saying so. Change them with note_properties instead. Edits to the note's own text are still note_edit's.`;

/** What a refused write means to pi, and what to do about it. */
const refusal = (path: string, result: Extract<WriteResult, { ok: false }>): string => {
	if (result.reason === "conflict") return `${path} changed while you were working on it — the person is typing in it. Read it again and redo your change on what is there now.`;
	if (result.reason === "missing") return `${path} is not there. Use note_write to make it.`;
	return `${path} is not a note this folder holds.`;
};

const said = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

export const noteTools = (root: string, write: WriteNote) => (pi: ExtensionAPI) => {
	/**
	 * The note this call names, as the vault names it, and as it is right now.
	 * `had` is null for one that is not there yet — which note_write may make
	 * and note_edit has nothing to change. A path that is not a note at all
	 * throws, because there is nothing sensible to do with it here.
	 */
	const open = (given: string): { path: string; had: Note | null } => {
		const path = notePath(root, given);
		if (!path) throw new Error(`${given} is not a note in this folder. Notes are markdown files under it; use write for anything else.`);
		return { path, had: readNote(root, path) };
	};

	const put = (path: string, had: Note | null, text: string, ctx: ExtensionContext): void => {
		const result = write(path, had, text, ctx.sessionManager.getSessionId(), ctx.sessionManager.getLeafId() ?? undefined);
		if (!result.ok) throw new Error(refusal(path, result));
	};

	pi.registerTool({
		name: "note_edit",
		label: "Edit note",
		description:
			"Make precise edits to one note by exact text replacement. Notes are edited with this rather than with edit, so that what you write is kept as yours and the person can see it, accept it, or put it back.",
		promptSnippet: "Make precise note edits with exact text replacement, including multiple disjoint edits in one call",
		promptGuidelines: [
			"Use note_edit, not edit, for any markdown note in this folder; edit and write are refused on notes.",
			"edits[].oldText must match the note exactly and be unique in it. Keep it as small as it can be while staying unique.",
			"When changing several separate places in one note, send one note_edit call with several entries in edits[].",
			"Each edits[].oldText is matched against the note as it is now, not after earlier edits are applied. Do not send overlapping edits.",
		],
		parameters: editSchema,
		prepareArguments: (args) => prepareEdits(args) as Static<typeof editSchema>,
		execute: async (_id, params, _signal, _onUpdate, ctx) => {
			const { path, had } = open(params.path);
			if (!had) throw new Error(`${path} is not there. Use note_write to make it.`);
			const applied = applyEdits(had.text, params.edits);
			if (!applied.ok) throw new Error(applied.reason);
			// Against the block as it was: one that reads now and not after is a
			// block this edit broke, and one that never read is text to be fixed.
			const block = propertiesOf(had.text);
			if (block.block && block.errors.length === 0 && applied.text.slice(0, block.block.to) !== had.text.slice(0, block.block.to)) {
				throw new Error(IN_PROPERTIES(path));
			}
			put(path, had, applied.text, ctx);
			return said(`Replaced ${params.edits.length} block(s) in ${path}.`);
		},
	});

	pi.registerTool({
		name: "note_properties",
		label: "Note properties",
		description:
			"Set or remove the properties at the top of one note — its tags, its dates, whatever it is filed by. Properties are changed with this rather than by editing the note's text, so that the block stays readable and the note keeps its place in the index.",
		promptSnippet: "Set or remove a note's properties without touching its text",
		promptGuidelines: [
			"Use note_properties for anything in the `---` block at the top of a note; note_edit is refused there while the block can be read.",
			"Read the note first: set[].value replaces what is there, so a list must be sent whole — the values it should end up with, not the one being added.",
			"Set a property to null to leave it empty; put its name in remove[] to take it out of the note altogether.",
			"Several properties in one call, not one call each: the person sees one change to accept.",
		],
		parameters: propertiesSchema,
		execute: async (_id, params, _signal, _onUpdate, ctx) => {
			const { path, had } = open(params.path);
			if (!had) throw new Error(`${path} is not there. Use note_write to make it.`);
			const changes = { set: params.set ?? [], remove: params.remove ?? [] };
			const applied = applyProperties(had.text, changes);
			if (!applied.ok) throw new Error(applied.reason);
			if (applied.text === had.text) return said(`${path} already says that; nothing was written.`);
			put(path, had, applied.text, ctx);
			const told = [...changes.set.map((s) => s.name), ...changes.remove].join(", ");
			return said(`Changed ${told} in ${path}.`);
		},
	});

	pi.registerTool({
		name: "note_write",
		label: "Write note",
		description: "Make a new note, or replace one completely. Notes are written with this rather than with write, so that what you write is kept as yours.",
		promptSnippet: "Create or overwrite notes",
		promptGuidelines: ["Use note_write only for a new note or a complete rewrite; use note_edit to change part of one."],
		parameters: writeSchema,
		execute: async (_id, params, _signal, _onUpdate, ctx) => {
			const { path, had } = open(params.path);
			put(path, had, params.content, ctx);
			return said(had ? `Rewrote ${path}.` : `Made ${path}.`);
		},
	});
};
