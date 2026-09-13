import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { Plus, X } from "lucide-react";
import { type Document, isScalar, isSeq, type Pair } from "yaml";

import { bodyStart, type Properties as Read, withProperties } from "../../../properties.ts";
import { propertiesEdit } from "../features/properties";
import { toggleLivePreview } from "../features/livePreview";
import { Button } from "./ui/button";

/**
 * The note's properties, as rows above its text: a name, a value, and a way
 * to change either. Drawn from what the editor holds, not from the file:
 * the block is in the editor's document, hidden, and a change here is a
 * change to it — one transaction over the block's lines, which ⌘Z takes
 * back and the save sends, as any typing is. Nothing here touches the disk.
 *
 * It sits beside the editor rather than in it, as Obsidian's does: a widget
 * at the top of a document is where the cursor's troubles live, and inputs
 * inside one where the focus's are. The rows are the projection of the
 * text; ⌘E shows the text itself.
 *
 * A value is a line of text, or a list of them as chips — `tags` and
 * `aliases` are lists whichever way they were written. Anything else, a
 * nested mapping, is shown and not edited: the source is one key away.
 * A block that does not parse is said so, and left exactly as it is.
 */
export function Properties({ view, read }: { view: EditorView | null; read: Read | null }) {
	const [adding, setAdding] = useState(false);
	if (!view || !read) return null;

	/** Put a change to the document's properties into the editor as one change over the block's lines. */
	const apply = (edit: (doc: Document) => void): boolean => {
		const text = view.state.doc.toString();
		const next = withProperties(text, edit);
		if (!next.ok) return false;
		// The same text is not a change: a value committed twice — Enter, then the box losing focus — is one change, and one undo.
		if (next.text === text) return true;
		view.dispatch({
			changes: { from: 0, to: bodyStart(text), insert: next.text.slice(0, bodyStart(next.text)) },
			annotations: propertiesEdit.of(true),
			userEvent: "input",
		});
		return true;
	};

	if (read.block && read.errors.length > 0) {
		return (
			<Frame>
				<div role="alert" className="flex items-center gap-3 text-xs text-muted-foreground">
					<span className="flex-1">The properties could not be read: {read.errors[0].message.split("\n")[0]}</span>
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs"
						onClick={() => {
							toggleLivePreview(view);
							view.dispatch({ selection: { anchor: 0 } });
							view.focus();
						}}
					>
						Edit the source
					</Button>
				</div>
			</Frame>
		);
	}

	const items: Pair[] = read.block && read.doc.contents && "items" in read.doc.contents ? (read.doc.contents as { items: Pair[] }).items : [];
	const names = new Set(items.map((p) => nameOf(p)));
	return (
		<Frame>
			{items.map((pair) => {
				const name = nameOf(pair);
				return (
					<Row key={name} name={name} onRemove={() => apply((doc) => doc.delete(name))}>
						<Value name={name} node={pair.value} apply={apply} />
					</Row>
				);
			})}
			{adding ? (
				<NameInput
					taken={names}
					onDone={(name) => {
						setAdding(false);
						if (name) apply((doc) => doc.set(name, null));
					}}
				/>
			) : (
				<button
					type="button"
					id="add-property"
					onClick={() => setAdding(true)}
					className="flex cursor-default items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<Plus className="size-3" />
					Add property
				</button>
			)}
		</Frame>
	);
}

const Frame = ({ children }: { children: React.ReactNode }) => (
	<div id="properties" className="mx-auto flex w-full max-w-[42rem] flex-col gap-1 px-6 pt-4 text-sm">
		{children}
	</div>
);

const nameOf = (pair: Pair) => String(isScalar(pair.key) ? pair.key.value : pair.key);

function Row({ name, children, onRemove }: { name: string; children: React.ReactNode; onRemove: () => void }) {
	return (
		<div className="group flex min-h-7 items-center gap-2" data-property={name}>
			<span className="w-32 shrink-0 truncate text-muted-foreground" title={name}>
				{name}
			</span>
			<div className="min-w-0 flex-1">{children}</div>
			<button
				type="button"
				aria-label={`Remove ${name}`}
				onClick={onRemove}
				className="shrink-0 cursor-default rounded-sm p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
			>
				<X className="size-3" />
			</button>
		</div>
	);
}

/** `tags` and `aliases` are lists however they were written; anything written as a list is one. */
const LISTS = new Set(["tags", "aliases"]);

function Value({ name, node, apply }: { name: string; node: unknown; apply: (edit: (doc: Document) => void) => boolean }) {
	if (isSeq(node) || LISTS.has(name)) return <ListValue name={name} node={node} apply={apply} />;
	if (node === null || node === undefined || isScalar(node)) {
		const value = isScalar(node) ? node.value : null;
		return <TextValue text={value === null || value === undefined ? "" : String(value)} onCommit={(text) => apply((doc) => doc.set(name, typed(value, text)))} />;
	}
	// A mapping, or something else YAML can say and a row cannot: shown, and edited in the source.
	return (
		<span className="text-muted-foreground" title="Edit this one in the source (⌘E)">
			{JSON.stringify(toPlain(node))}
		</span>
	);
}

const toPlain = (node: unknown) => (node && typeof node === "object" && "toJSON" in node ? (node as { toJSON(): unknown }).toJSON() : node);

/**
 * What a typed value means: a number where a number was, true or false
 * where one was, nothing where the field was emptied, and text otherwise.
 * The property's own type, when there is one, will decide this instead.
 */
function typed(was: unknown, text: string): unknown {
	const t = text.trim();
	if (t === "") return null;
	if (typeof was === "number" && t !== "" && Number.isFinite(Number(t))) return Number(t);
	if (typeof was === "boolean" && (t === "true" || t === "false")) return t === "true";
	return text;
}

/** A line of text: Enter or leaving commits what changed, Escape puts back what was. */
function TextValue({ text, onCommit }: { text: string; onCommit: (text: string) => void }) {
	const box = useRef<HTMLInputElement>(null);
	const commit = () => {
		const now = box.current?.value ?? "";
		if (now !== text) onCommit(now);
	};
	return (
		<input
			key={text}
			ref={box}
			type="text"
			defaultValue={text}
			spellCheck={false}
			className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
			placeholder="Empty"
			onKeyDown={(e) => {
				if (e.nativeEvent.isComposing) return;
				if (e.key === "Enter") {
					e.preventDefault();
					commit();
					e.currentTarget.blur();
				} else if (e.key === "Escape") {
					e.preventDefault();
					if (box.current) box.current.value = text;
					e.currentTarget.blur();
				}
			}}
			onBlur={commit}
		/>
	);
}

/** Names as chips, and a box to add one; Backspace in the empty box takes the last chip. */
function ListValue({ name, node, apply }: { name: string; node: unknown; apply: (edit: (doc: Document) => void) => boolean }) {
	const items: string[] = isSeq(node) ? node.items.map((i) => String(toPlain(i) ?? "")).filter((s) => s !== "") : isScalar(node) && node.value != null && node.value !== "" ? [String(node.value)] : [];
	const box = useRef<HTMLInputElement>(null);
	// The list as it was written — `[a, b]` or one per line — keeps its shape: its items are replaced, not the list.
	const set = (list: string[]) =>
		apply((doc) => {
			const was = doc.get(name, true);
			if (list.length === 0) doc.set(name, null);
			else if (isSeq(was)) was.items = list.map((v) => doc.createNode(v));
			else doc.set(name, list);
		});
	const add = () => {
		const value = (box.current?.value ?? "").trim().replace(/^#/, "");
		if (!value) return;
		if (box.current) box.current.value = "";
		if (!items.includes(value)) set([...items, value]);
	};
	return (
		<div className="flex flex-wrap items-center gap-1">
			{items.map((item, i) => (
				<span key={`${item}-${i}`} className="flex items-center gap-0.5 rounded-sm bg-muted px-1.5 text-xs" data-chip={item}>
					{item}
					<button
						type="button"
						aria-label={`Remove ${item}`}
						onClick={() => set(items.filter((_, j) => j !== i))}
						className="cursor-default rounded-sm text-muted-foreground hover:text-foreground"
					>
						<X className="size-3" />
					</button>
				</span>
			))}
			<input
				ref={box}
				type="text"
				spellCheck={false}
				aria-label={`Add to ${name}`}
				className="min-w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				placeholder={items.length === 0 ? "Empty" : ""}
				onKeyDown={(e) => {
					if (e.nativeEvent.isComposing) return;
					if (e.key === "Enter" || e.key === ",") {
						e.preventDefault();
						add();
					} else if (e.key === "Backspace" && box.current?.value === "" && items.length > 0) {
						e.preventDefault();
						set(items.slice(0, -1));
					}
				}}
				onBlur={add}
			/>
		</div>
	);
}

/** The name of a property being added: Enter with a name not yet taken adds it; Escape, or leaving, adds nothing. */
function NameInput({ taken, onDone }: { taken: Set<string>; onDone: (name: string | null) => void }) {
	const box = useRef<HTMLInputElement>(null);
	useEffect(() => box.current?.focus(), []);
	const finish = (commit: boolean) => {
		const name = (box.current?.value ?? "").trim();
		onDone(commit && name && !taken.has(name) ? name : null);
	};
	return (
		<div className="flex min-h-7 items-center gap-2">
			<input
				ref={box}
				type="text"
				spellCheck={false}
				aria-label="Property name"
				placeholder="Name"
				className="w-32 bg-transparent outline-none placeholder:text-muted-foreground"
				onKeyDown={(e) => {
					if (e.nativeEvent.isComposing) return;
					if (e.key === "Enter") {
						e.preventDefault();
						finish(true);
					} else if (e.key === "Escape") {
						e.preventDefault();
						finish(false);
					}
				}}
				onBlur={() => finish(true)}
			/>
		</div>
	);
}
