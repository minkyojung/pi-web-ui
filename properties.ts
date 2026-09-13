/**
 * What a note's front matter says, and how it is changed without changing
 * anything else.
 *
 * The block's place is the parser's to say (frontmatter.ts); what is inside
 * is YAML, read here as a document rather than an object — every value with
 * its quotes, every comment, every blank line — so that a change to one
 * property is a change to its lines and no other's. Obsidian turns the
 * block into an object and writes the object back, and its users lose their
 * comments and their quotes; this writes back only the properties that were
 * changed or added, and copies the rest from the note as they were.
 *
 * No value is given a type here. `date: 2024-01-01` is a string, as YAML 1.2
 * has it; whether it is a date is for a property's type to say, and one
 * library's guess about it is the wrong place for that to be decided.
 *
 * A block that does not parse is left exactly as it is: it is shown as
 * broken, and no change is written over it. Obsidian once wrote over broken
 * blocks, and lost them.
 */
import { Document, isMap, isSeq, type Pair, parseDocument, Scalar, YAMLMap, type YAMLError } from "yaml";
import { parser } from "./syntax.ts";

/** Where the block sits in the note, and where its YAML sits inside it. */
export type Block = {
	from: number;
	/** After the closing `---`: the newline that follows it, if any, is the body's. */
	to: number;
	/** The lines between the fences, each ending in its newline. */
	yaml: { from: number; to: number };
};

export type Properties =
	| { block: null }
	| {
			block: Block;
			doc: Document;
			/** Non-empty for a block that does not parse; `doc` is then not to be trusted or written. */
			errors: readonly YAMLError[];
	  };

/** How new YAML is written: nothing folded, `[a, b]` as written, an empty value as `key:`. */
const WRITE = { lineWidth: 0, flowCollectionPadding: false, nullStr: "" } as const;

function blockOf(text: string): Block | null {
	const first = parser.parse(text).topNode.firstChild;
	if (!first || first.name !== "FrontMatter") return null;
	const marks = first.getChildren("FrontMatterMark");
	const open = text.indexOf("\n", marks[0].to) + 1;
	return { from: first.from, to: first.to, yaml: { from: open, to: marks[1].from } };
}

/** Where the note's own text begins: under the block, or at the top when there is none. */
export function bodyStart(text: string): number {
	const block = blockOf(text);
	return block ? Math.min(text.length, block.to + (text[block.to] === "\n" ? 1 : 0)) : 0;
}

/** The note's properties, or none: a block that is there is parsed, and its errors reported rather than thrown. */
export function propertiesOf(text: string): Properties {
	return propertiesIn(text, blockOf(text));
}

/** The properties in a block already found — by the editor, in its own tree — so the note is not parsed twice. */
export function propertiesIn(text: string, block: Block | null): Properties {
	if (!block) return { block: null };
	const doc = parseDocument(text.slice(block.yaml.from, block.yaml.to));
	const errors = doc.errors.length === 0 && doc.contents !== null && !isMap(doc.contents) ? [notAMap()] : doc.errors;
	return { block, doc, errors };
}

/** YAML can hold a list or a scalar at the top; properties are a mapping, and anything else is refused the same way as a parse error. */
function notAMap(): YAMLError {
	const err = new Error("Properties must be a mapping of names to values") as YAMLError;
	err.code = "UNEXPECTED_TOKEN";
	err.pos = [0, 0];
	return err;
}

export type Edited = { ok: true; text: string } | { ok: false; reason: "invalid" };

/**
 * The note with its properties changed by `edit`, which is handed the
 * document and mutates it — `doc.set("date", "2024-01-01")`, `doc.delete`.
 * A note without a block is given one on its first line; a block emptied is
 * taken away. A block that does not parse, or a change that leaves it not
 * parsing, is refused, and the note is untouched.
 */
export function withProperties(text: string, edit: (doc: Document) => void): Edited {
	const had = propertiesOf(text);
	if (had.block && had.errors.length > 0) return { ok: false, reason: "invalid" };
	const doc = had.block ? had.doc : new Document(new YAMLMap());
	if (doc.contents === null) doc.contents = new YAMLMap();
	if (!isMap(doc.contents)) return { ok: false, reason: "invalid" };
	const source = had.block ? text.slice(had.block.yaml.from, had.block.yaml.to) : "";
	const before = snapshot(doc.contents, source);
	edit(doc);
	if (doc.errors.length > 0 || !isMap(doc.contents)) return { ok: false, reason: "invalid" };

	let out: string;
	if (doc.contents.items.length === 0) {
		// Nothing left to say: no block, as Obsidian leaves a note whose last property is removed.
		out = had.block ? text.slice(had.block.to + (text[had.block.to] === "\n" ? 1 : 0)) : text;
	} else {
		const yaml = merge(doc.contents, before, source);
		out = had.block ? text.slice(0, had.block.yaml.from) + yaml + text.slice(had.block.yaml.to) : `---\n${yaml}---\n${text}`;
	}
	// Read back before it is believed: the block must still be one, must
	// parse, and must say what was meant.
	if (out !== text) {
		const now = propertiesOf(out);
		const meant = JSON.stringify(doc.toJS());
		if (doc.contents.items.length === 0 ? now.block !== null : !now.block || now.errors.length > 0 || JSON.stringify(now.doc.toJS()) !== meant) {
			return { ok: false, reason: "invalid" };
		}
	}
	return { ok: true, text: out };
}

/** A property as it was before the edit: its pair, its lines in the source, and what it said. */
type Was = { pair: Pair; from: number; to: number; said: string };

function snapshot(map: YAMLMap, source: string): Was[] {
	const out: Was[] = [];
	for (const pair of map.items) {
		const key = pair.key as { range?: [number, number, number] };
		const value = pair.value as { range?: [number, number, number] } | null;
		if (!key.range) continue;
		// Through the end of the line the value ends on: a `key:` with no value
		// ends at the colon, and its newline is the line's.
		let to = value?.range?.[2] ?? key.range[2];
		if (source[to - 1] !== "\n") {
			const eol = source.indexOf("\n", to);
			if (/^[ \t\r]*$/.test(source.slice(to, eol < 0 ? source.length : eol))) to = eol < 0 ? source.length : eol + 1;
		}
		out.push({ pair, from: key.range[0], to, said: saying(pair) });
	}
	return out;
}

const saying = (pair: Pair) => JSON.stringify([toPlain(pair.key), toPlain(pair.value)]);
const toPlain = (node: unknown) => (node && typeof node === "object" && "toJSON" in node ? (node as { toJSON(): unknown }).toJSON() : node);

/**
 * The block's YAML after the edit: each property that is as it was is its
 * own lines from the source, with the comments and blank lines above it;
 * one changed or added is written afresh; one removed takes its lines with
 * it. What follows the last of the old properties — a closing comment —
 * stays at the end.
 */
function merge(map: YAMLMap, before: Was[], source: string): string {
	const tail = before.length > 0 ? source.slice(before[before.length - 1].to) : source;
	let out = "";
	let tailDone = false;
	map.items.forEach((pair, i) => {
		const at = before.findIndex((w) => w.pair === pair);
		if (at >= 0) {
			const was = before[at];
			out += source.slice(at > 0 ? before[at - 1].to : 0, was.from);
			out += saying(pair) === was.said ? source.slice(was.from, was.to) : fresh(pair);
			return;
		}
		if (!tailDone && !map.items.slice(i + 1).some((p) => before.some((w) => w.pair === p))) {
			out += tail;
			tailDone = true;
		}
		out += fresh(pair);
	});
	if (!tailDone) out += tail;
	return out;
}

/** One property written anew. Its comment above, if it had one, is in the source already, and is not written twice. */
function fresh(pair: Pair): string {
	// A key set through the document is a bare string; one read from the source is a node, which is where its comment hangs.
	if (pair.key && typeof pair.key === "object") {
		const key = pair.key as { commentBefore?: string | null; spaceBefore?: boolean };
		key.commentBefore = null;
		key.spaceBefore = false;
	}
	// A value set as nothing is a bare null, which YAML would write as an explicit key (`? k`); as a node it is `k:`.
	if (pair.value === null || pair.value === undefined) pair.value = new Scalar(null);
	const one = new YAMLMap();
	one.items = [pair];
	return new Document(one).toString(WRITE);
}

/**
 * A property that holds names — `tags`, `aliases` — as the list it means,
 * whichever way it was written: `tags: a`, `tags: [a, b]`, or one per line.
 * Anything that is not a name is left out; a `#` in front of a tag is not
 * part of it, as Obsidian has it.
 */
export function listOf(doc: Document, key: string): string[] {
	const node = doc.get(key, true);
	const items = isSeq(node) ? node.items.map(toPlain) : [toPlain(node)];
	return items
		.filter((v): v is string | number => typeof v === "string" || typeof v === "number")
		.map((v) => String(v).replace(/^#/, "").trim())
		.filter((v) => v !== "");
}
