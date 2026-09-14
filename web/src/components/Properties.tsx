import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EditorView } from "@codemirror/view";
import { AlignLeft, Calendar, CalendarClock, Hash, List, Plus, SquareCheck, Tags, TriangleAlert, X } from "lucide-react";
import { type Document, isScalar, isSeq, type Pair } from "yaml";

import { bodyStart, type Properties as Read, withProperties } from "../../../properties.ts";
import { fits, fromInput, isReserved, PROPERTY_TYPES, type PropertyType, typeOf } from "../../../propertyTypes.ts";
import { propertiesEdit } from "../features/properties";
import { toggleLivePreview } from "../features/livePreview";
import { propertyTypesStore } from "../serverState";
import { send } from "../ws";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";

/** The app's input, flat: a row is a line of a table, not a form field with a box around it. */
const FLAT = "h-7 rounded-none border-0 px-0 shadow-none focus-visible:ring-0 dark:bg-transparent";

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
 * Each row is drawn by its type (propertyTypes.ts): a box for a checkbox,
 * a date picker for a date, chips for a list — `tags` and `aliases` are
 * lists whichever way they were written. The type is the name's, chosen
 * from the row's icon and kept for the whole vault, or guessed from the
 * value. A value that does not fit is shown as text with a warning, never
 * corrected. A nested mapping is shown and not edited: the source is one
 * key away. A block that does not parse is said so, and left as it is.
 */
export function Properties({ view, read }: { view: EditorView | null; read: Read | null }) {
	const [adding, setAdding] = useState(false);
	const chosen = useSyncExternalStore(propertyTypesStore.subscribe, propertyTypesStore.get);
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
				<Alert className="flex items-center gap-3 py-2">
					<AlertDescription className="flex-1">The properties could not be read: {read.errors[0].message.split("\n")[0]}</AlertDescription>
					<Button
						variant="outline"
						size="xs"
						onClick={() => {
							toggleLivePreview(view);
							view.dispatch({ selection: { anchor: 0 } });
							view.focus();
						}}
					>
						Edit the source
					</Button>
				</Alert>
			</Frame>
		);
	}

	const items: Pair[] = read.block && read.doc.contents && "items" in read.doc.contents ? (read.doc.contents as { items: Pair[] }).items : [];
	const names = new Set(items.map((p) => nameOf(p)));
	return (
		<Frame>
			{items.map((pair) => {
				const name = nameOf(pair);
				const type = typeOf(name, toPlain(pair.value), chosen);
				return (
					<Row key={name} name={name} type={type} chosen={name.toLowerCase() in chosen} onRemove={() => apply((doc) => doc.delete(name))}>
						<Value name={name} type={type} node={pair.value} apply={apply} />
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
				<Button id="add-property" variant="ghost" size="xs" className="w-fit text-muted-foreground" onClick={() => setAdding(true)}>
					<Plus />
					Add property
				</Button>
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

/** What each type is called and drawn as. */
const TYPES: Record<PropertyType, { label: string; Icon: typeof Hash }> = {
	text: { label: "Text", Icon: AlignLeft },
	list: { label: "List", Icon: List },
	number: { label: "Number", Icon: Hash },
	checkbox: { label: "Checkbox", Icon: SquareCheck },
	date: { label: "Date", Icon: Calendar },
	datetime: { label: "Date & time", Icon: CalendarClock },
	tags: { label: "Tags", Icon: Tags },
};

function Row({ name, type, chosen, children, onRemove }: { name: string; type: PropertyType; chosen: boolean; children: React.ReactNode; onRemove: () => void }) {
	return (
		<div className="group flex min-h-7 items-center gap-2" data-property={name} data-type={type}>
			<TypeMenu name={name} type={type} chosen={chosen} />
			<span className="w-28 shrink-0 truncate text-muted-foreground" title={name}>
				{name}
			</span>
			<div className="min-w-0 flex-1">{children}</div>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={`Remove ${name}`}
				onClick={onRemove}
				className="shrink-0 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
			>
				<X />
			</Button>
		</div>
	);
}

/**
 * The row's icon is its type, and a menu to choose another for the name —
 * for every note, since the type is the name's. "As the value says" takes
 * the choice back. `tags` and `aliases` are not for choosing.
 */
function TypeMenu({ name, type, chosen }: { name: string; type: PropertyType; chosen: boolean }) {
	const { label, Icon } = TYPES[type];
	const reserved = isReserved(name);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={reserved}>
				<Button variant="ghost" size="icon-xs" aria-label={`Type of ${name}`} title={`${label}${reserved ? "" : " — click to change"}`} className="shrink-0 text-muted-foreground">
					<Icon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup value={type} onValueChange={(t) => send({ type: "set_property_type", name, propertyType: t as PropertyType })}>
					{PROPERTY_TYPES.filter((t) => t !== "tags").map((t) => {
						const T = TYPES[t];
						return (
							<DropdownMenuRadioItem key={t} value={t}>
								<T.Icon className="size-3.5 text-muted-foreground" />
								{T.label}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
				{chosen && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuRadioGroup value="" onValueChange={() => send({ type: "set_property_type", name, propertyType: null })}>
							<DropdownMenuRadioItem value="guess">As the value says</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function Value({ name, type, node, apply }: { name: string; type: PropertyType; node: unknown; apply: (edit: (doc: Document) => void) => boolean }) {
	const value = toPlain(node);
	const set = (v: unknown) => apply((doc) => doc.set(name, v));
	// Not what the type says: shown as it is, in text, with a word about it; never corrected.
	if (!fits(type, value)) {
		if (value !== null && typeof value === "object" && !Array.isArray(value)) return <Unshown value={value} />;
		return (
			<div className="flex items-center gap-2">
				<TextValue text={asText(value)} onCommit={(text) => set(fromInput("text", text))} />
				<TriangleAlert className="size-3.5 shrink-0 text-destructive" aria-label={`Not a ${TYPES[type].label.toLowerCase()}`} />
			</div>
		);
	}
	switch (type) {
		case "list":
		case "tags":
			return <ListValue name={name} node={node} apply={apply} />;
		case "checkbox":
			return <Checkbox checked={value === true} aria-label={name} onCheckedChange={(on) => set(on === true)} />;
		case "number":
			return <TextValue kind="number" text={asText(value)} onCommit={(text) => set(fromInput("number", text))} />;
		case "date":
			return <TextValue kind="date" text={asText(value)} onCommit={(text) => set(fromInput("date", text))} />;
		case "datetime":
			return <TextValue kind="datetime-local" text={asText(value)} onCommit={(text) => set(fromInput("datetime", text))} />;
		default:
			if (value !== null && typeof value === "object" && !Array.isArray(value)) return <Unshown value={value} />;
			return <TextValue text={asText(Array.isArray(value) ? value[0] : value)} onCommit={(text) => set(fromInput("text", text))} />;
	}
}

/** A mapping, or something else YAML can say and a row cannot: shown, and edited in the source. */
const Unshown = ({ value }: { value: unknown }) => (
	<span className="text-muted-foreground" title="Edit this one in the source (⌘E)">
		{JSON.stringify(value)}
	</span>
);

const toPlain = (node: unknown) => (node && typeof node === "object" && "toJSON" in node ? (node as { toJSON(): unknown }).toJSON() : node);
const asText = (value: unknown) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** A line of text — or a number, a date, a time, by `kind` — Enter or leaving commits what changed, Escape puts back what was. */
function TextValue({ text, kind = "text", onCommit }: { text: string; kind?: "text" | "number" | "date" | "datetime-local"; onCommit: (text: string) => void }) {
	const box = useRef<HTMLInputElement>(null);
	const commit = () => {
		const now = box.current?.value ?? "";
		if (now !== text) onCommit(now);
	};
	return (
		<Input
			key={text}
			ref={box}
			type={kind}
			defaultValue={text}
			spellCheck={false}
			className={`${FLAT} ${kind === "text" ? "" : "w-auto"}`}
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
				<Badge key={`${item}-${i}`} variant="secondary" className="gap-0.5 pr-1 font-normal" data-chip={item}>
					{item}
					<button
						type="button"
						aria-label={`Remove ${item}`}
						onClick={() => set(items.filter((_, j) => j !== i))}
						className="cursor-default rounded-full text-muted-foreground hover:text-foreground"
					>
						<X />
					</button>
				</Badge>
			))}
			<Input
				ref={box}
				spellCheck={false}
				aria-label={`Add to ${name}`}
				className={`${FLAT} w-auto min-w-16 flex-1`}
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
			<Input
				ref={box}
				spellCheck={false}
				aria-label="Property name"
				placeholder="Name"
				className={`${FLAT} w-32`}
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
