import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EditorView } from "@codemirror/view";
import { Command as CommandPrimitive } from "cmdk";
import { AlignLeft, Calendar, CalendarClock, Hash, List, Plus, SquareCheck, Tags, TriangleAlert, X } from "lucide-react";
import { type Document, isScalar, isSeq, type Pair } from "yaml";

import { bodyStart, type Properties as Read, suits, withProperties } from "../../../properties.ts";
import { fits, fromInput, isReserved, keyOf, PROPERTY_TYPES, type PropertyType, typeOf } from "../../../propertyTypes.ts";
import { stepInProperties } from "../features/pageMove";
import { propertiesEdit } from "../features/properties";
import { toggleLivePreview } from "../features/livePreview";
import { propertyNamesStore, propertyTypesStore } from "../serverState";
import { send } from "../ws";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Command, CommandItem, CommandList } from "./ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";

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
	const used = useSyncExternalStore(propertyNamesStore.subscribe, propertyNamesStore.get);
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
	// By the lower-case name, as a property is known by (propertyTypes.ts): a note with `status` is not offered `Status`.
	const taken = new Set(items.map((p) => keyOf(nameOf(p))));
	return (
		<Frame>
			{items.map((pair) => {
				const name = nameOf(pair);
				const type = typeOf(name, toPlain(pair.value), chosen);
				return (
					<Row key={name} name={name} type={type} chosen={name.toLowerCase() in chosen} onRemove={() => apply((doc) => doc.delete(name))}>
						<Value name={name} type={type} node={pair.value} said={used.values[keyOf(name)] ?? []} apply={apply} />
					</Row>
				);
			})}
			{adding ? (
				<NameInput
					taken={taken}
					names={used.names}
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

/**
 * The rows, and ↑ ↓ down them. At the panel's ends the page goes on — the
 * title above, the note's text below (pageMove.ts).
 *
 * On the way down, before the boxes: a bare ↓ in a row means the next row,
 * and the list under a box would otherwise take it on its way past (cmdk
 * answers the arrows whether or not it has anything to show). A box whose
 * list is up says so and keeps them; so does one that counts its own value
 * with them — a number, a date. Anything held down with the arrow is not
 * the page's key at all.
 */
const Frame = ({ children }: { children: React.ReactNode }) => (
	<div
		id="properties"
		className="mx-auto flex w-full max-w-[42rem] flex-col gap-1 px-6 pt-4 text-sm"
		onKeyDownCapture={(e) => {
			if (e.nativeEvent.isComposing || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
			if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
			const box = e.target as HTMLElement;
			if (box.closest("[data-suggesting]")) return;
			if (box instanceof HTMLInputElement && box.type !== "text") return;
			if (stepInProperties(box, e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
		}}
	>
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

function Value({ name, type, node, said, apply }: { name: string; type: PropertyType; node: unknown; said: string[]; apply: (edit: (doc: Document) => void) => boolean }) {
	const value = toPlain(node);
	const set = (v: unknown) => apply((doc) => doc.set(name, v));
	// Not what the type says: shown as it is, in text, with a word about it; never corrected.
	if (!fits(type, value)) {
		if (value !== null && typeof value === "object" && !Array.isArray(value)) return <Unshown value={value} />;
		return (
			<div className="flex items-center gap-2">
				<TextValue text={asText(value)} options={said} onCommit={(text) => set(fromInput("text", text))} />
				<TriangleAlert className="size-3.5 shrink-0 text-destructive" aria-label={`Not a ${TYPES[type].label.toLowerCase()}`} />
			</div>
		);
	}
	switch (type) {
		case "list":
		case "tags":
			return <ListValue name={name} node={node} options={said} apply={apply} />;
		case "checkbox":
			return <Checkbox checked={value === true} aria-label={name} onCheckedChange={(on) => set(on === true)} />;
		// A number, a date and a time have a box of their own: what to put in
		// them is a picker's to say, not a list of what other notes hold.
		case "number":
			return <TextValue kind="number" text={asText(value)} onCommit={(text) => set(fromInput("number", text))} />;
		case "date":
			return <TextValue kind="date" text={asText(value)} onCommit={(text) => set(fromInput("date", text))} />;
		case "datetime":
			return <TextValue kind="datetime-local" text={asText(value)} onCommit={(text) => set(fromInput("datetime", text))} />;
		default:
			if (value !== null && typeof value === "object" && !Array.isArray(value)) return <Unshown value={value} />;
			return <TextValue text={asText(Array.isArray(value) ? value[0] : value)} options={said} onCommit={(text) => set(fromInput("text", text))} />;
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

/**
 * A line of text — or a number, a date, a time, by `kind` — Enter or leaving
 * commits what changed, Escape puts back what was. A text box is offered the
 * values the same name holds elsewhere in the vault.
 */
function TextValue({ text, kind = "text", options = [], onCommit }: { text: string; kind?: "text" | "number" | "date" | "datetime-local"; options?: string[]; onCommit: (text: string) => void }) {
	const [typed, setTyped] = useState(text);
	const [shown, setShown] = useState(text);
	// The document said something else while the box was open — pi wrote, or ⌘Z — so the box says it too.
	if (shown !== text) {
		setShown(text);
		setTyped(text);
	}
	const commit = (now: string) => {
		if (now !== text) onCommit(now);
	};
	const box = (offered: (e: React.KeyboardEvent) => boolean) => (
		<Input
			type={kind}
			value={typed}
			onChange={(e) => setTyped(e.target.value)}
			spellCheck={false}
			className={`${FLAT} ${kind === "text" ? "" : "w-auto"}`}
			placeholder="Empty"
			onKeyDown={(e) => {
				if (e.nativeEvent.isComposing || offered(e)) return;
				if (e.key === "Enter") {
					e.preventDefault();
					commit(typed);
					e.currentTarget.blur();
				} else if (e.key === "Escape") {
					e.preventDefault();
					setTyped(text);
					e.currentTarget.blur();
				}
			}}
			onBlur={() => commit(typed)}
		/>
	);
	// A number, a date and a time have a picker of their own and nothing to
	// offer, so they are not made into a combobox at all. The box a list hangs
	// from is decided by the kind, not by whether there is anything to say: one
	// that changed shape when the vault learnt a value would take the focus
	// with it, mid-word.
	return kind === "text" ? (
		<Suggest
			options={options}
			value={typed}
			onChange={setTyped}
			onPick={(option) => {
				setTyped(option);
				commit(option);
			}}
		>
			{box}
		</Suggest>
	) : (
		box(() => false)
	);
}

/** Names as chips, and a box to add one — offered the ones this name already holds elsewhere; Backspace in the empty box takes the last chip. */
function ListValue({ name, node, options, apply }: { name: string; node: unknown; options: string[]; apply: (edit: (doc: Document) => void) => boolean }) {
	const items: string[] = isSeq(node) ? node.items.map((i) => String(toPlain(i) ?? "")).filter((s) => s !== "") : isScalar(node) && node.value != null && node.value !== "" ? [String(node.value)] : [];
	const [typed, setTyped] = useState("");
	// The list as it was written — `[a, b]` or one per line — keeps its shape: its items are replaced, not the list.
	const set = (list: string[]) =>
		apply((doc) => {
			const was = doc.get(name, true);
			if (list.length === 0) doc.set(name, null);
			else if (isSeq(was)) was.items = list.map((v) => doc.createNode(v));
			else doc.set(name, list);
		});
	const add = (what: string) => {
		const value = what.trim().replace(/^#/, "");
		setTyped("");
		if (value && !items.includes(value)) set([...items, value]);
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
			<Suggest options={options.filter((option) => !items.includes(option))} value={typed} onChange={setTyped} onPick={add}>
				{(offered) => (
					<Input
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						spellCheck={false}
						aria-label={`Add to ${name}`}
						className={`${FLAT} w-auto min-w-16 flex-1`}
						placeholder={items.length === 0 ? "Empty" : ""}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing || offered(e)) return;
							if (e.key === "Enter" || e.key === ",") {
								e.preventDefault();
								add(typed);
							} else if (e.key === "Backspace" && typed === "" && items.length > 0) {
								e.preventDefault();
								set(items.slice(0, -1));
							}
						}}
						onBlur={() => add(typed)}
					/>
				)}
			</Suggest>
		</div>
	);
}

/**
 * A box offered what the vault already says — the names its notes give their
 * properties, or the values one name has held (propertyIndex.ts).
 *
 * The list is cmdk's, under a popover anchored to the box: the box stays in
 * its row and keeps the focus, so typing is typing, while ↑ ↓ and Enter go
 * to the list. Obsidian's keys — Enter takes what is offered, Shift-Enter
 * keeps what was typed, Escape puts the list away — and the caller is told
 * which keys the list took so its own Enter does not fire twice.
 *
 * The narrowing is `suits` (properties.ts), not a fuzzy match: a box that
 * offers `updated` for `dat` and takes it on Enter writes the wrong
 * property name.
 */
function Suggest({
	options,
	value,
	onChange,
	onPick,
	children,
}: {
	options: string[];
	value: string;
	onChange: (text: string) => void;
	onPick: (option: string) => void;
	/** The box itself, told which keys the list has already dealt with. */
	children: (taken: (e: React.KeyboardEvent) => boolean) => React.ReactElement;
}) {
	const [wanted, setWanted] = useState(false);
	const [chosen, setChosen] = useState("");
	// Sorted by how well each answers, which is a stable sort, so alike answers stay in the order the vault uses them.
	const showing = options
		.map((option) => [option, suits(option, value)] as const)
		.filter(([, score]) => score > 0)
		.sort((a, b) => b[1] - a[1])
		.map(([option]) => option);
	const open = wanted && showing.length > 0;
	// The choice is held here rather than in cmdk, so that one no longer
	// offered — the list narrowed, or what was picked left it — cannot stay
	// chosen and leave Enter falling on nothing.
	const highlighted = showing.includes(chosen) ? chosen : (showing[0] ?? "");

	const taken = (e: React.KeyboardEvent): boolean => {
		if (e.nativeEvent.isComposing) return false;
		if (e.key === "Escape" && open) {
			e.preventDefault();
			setWanted(false);
			return true;
		}
		// Closed, and there is something to say: ⌥↓ asks for it, which is the
		// combobox pattern's key for it (WAI-ARIA APG). A plain ↓ is the page's,
		// and carries the cursor to the next row.
		if (e.key === "ArrowDown" && e.altKey && !open && showing.length > 0) {
			e.preventDefault();
			setWanted(true);
			return true;
		}
		if (!open) return false;
		// cmdk moves the choice and takes it. Shift-Enter is not offered to it: it means "what I typed".
		return e.key === "ArrowDown" || e.key === "ArrowUp" || (e.key === "Enter" && !e.shiftKey && highlighted !== "");
	};

	const pick = (option: string) => {
		setWanted(false);
		onPick(option);
	};

	return (
		// `contents`: the list's box is a box in the DOM, for the keys to reach it, and nothing in the layout.
		<Command className="contents" shouldFilter={false} loop value={highlighted} onValueChange={setChosen} data-suggesting={open ? "" : undefined}>
			<Popover open={open} onOpenChange={setWanted}>
				<PopoverAnchor asChild>
					<CommandPrimitive.Input
						asChild
						value={value}
						// Typed into, the list comes up; merely arrived at, it does not.
						// A list up the moment a box is reached would take the ↓ that
						// carries the cursor to the next row, and the WAI-ARIA combobox
						// pattern has it the same way: the popup opens on typing, or on ↓.
						onValueChange={(text) => {
							setWanted(true);
							onChange(text);
						}}
						onBlur={() => setWanted(false)}
					>
						{children(taken)}
					</CommandPrimitive.Input>
				</PopoverAnchor>
				<PopoverContent
					align="start"
					sideOffset={2}
					className="w-auto min-w-(--radix-popover-trigger-width) max-w-80 p-1"
					// The box keeps the focus: it is where the typing is, and a list that
					// took it would commit the box on the way out and lose the click.
					onOpenAutoFocus={(e) => e.preventDefault()}
					onCloseAutoFocus={(e) => e.preventDefault()}
					onMouseDown={(e) => e.preventDefault()}
					// A popover with the focus outside it takes itself away — which
					// here is every moment it is up, since the focus belongs to the
					// box it hangs under. Radix's own modal popover prevents this the
					// same way. A click elsewhere still closes it: the box loses the
					// focus, and that is what closes it.
					onFocusOutside={(e) => e.preventDefault()}
				>
					<CommandList>
						{showing.map((option) => (
							<CommandItem key={option} value={option} onSelect={() => pick(option)} data-suggestion={option}>
								{option}
							</CommandItem>
						))}
					</CommandList>
				</PopoverContent>
			</Popover>
		</Command>
	);
}

/**
 * The name of a property being added: Enter with a name not yet taken adds
 * it; Escape, or leaving, adds nothing. The names the vault already uses are
 * offered — a name reused is a type reused, since a type belongs to a name.
 */
function NameInput({ taken, names, onDone }: { taken: Set<string>; names: string[]; onDone: (name: string | null) => void }) {
	const [typed, setTyped] = useState("");
	const box = useRef<HTMLInputElement>(null);
	useEffect(() => box.current?.focus(), []);
	const finish = (name: string | null) => {
		const want = (name ?? "").trim();
		onDone(want && !taken.has(keyOf(want)) ? want : null);
	};
	return (
		<div className="flex min-h-7 items-center gap-2">
			<Suggest options={names.filter((name) => !taken.has(keyOf(name)))} value={typed} onChange={setTyped} onPick={finish}>
				{(offered) => (
					<Input
						ref={box}
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						spellCheck={false}
						aria-label="Property name"
						placeholder="Name"
						className={`${FLAT} w-32`}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing || offered(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								finish(typed);
							} else if (e.key === "Escape") {
								e.preventDefault();
								finish(null);
							}
						}}
						onBlur={() => finish(typed)}
					/>
				)}
			</Suggest>
		</div>
	);
}
