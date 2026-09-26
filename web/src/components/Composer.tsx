import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ArrowUpIcon, CornerDownLeftIcon, PencilIcon, ScanIcon, SquareIcon, TextQuoteIcon, X } from "lucide-react";

import { attach, filesToAttach, imagesOf } from "../attachments";
import { type Chosen as ChosenWords, chosenStore } from "../chosen";
import { acceptCommand, commandQuery, matchCommands, namesCommand } from "../commandMenu";
import { draftStore } from "../draft";
import { type FrontLabel, frontLabel } from "../frontLabel";
import { acceptMention, insertMention, matchNotes, mentionQuery } from "../noteMention";
import { titleOf } from "../noteSync";
import { appendRestored } from "../queue";
import { flushSaves } from "../saves";
import { askingAgainStore, commandsStore, configStore, documentsStore, filesStore, restoredStore, specsStore } from "../serverState";
import { applyServerEvent, getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";
import { InputGroupButton } from "./ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { type Suggestion, SuggestMenu } from "./SuggestMenu";
import { ModelPicker } from "./ModelPicker";
import { QueuedMessages } from "./QueuedMessages";
import { FrontMark } from "./FrontMark";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputHeader,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
} from "./ai-elements/prompt-input";

const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";

const SOURCE = { extension: "command", prompt: "prompt", skill: "skill" } as const;
/** No more notes than can be looked through; the word narrows it from there. */
const NOTES_OFFERED = 30;
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined);

/**
 * Send the text and empty the box, whichever way it was sent.
 *
 * The tab in front rides along as its address, beside the message and not
 * in it: the server tells pi for the turn, so the address is never part of
 * what was said, kept, compacted, or asked again later when it may be
 * another tab.
 * Whatever is typed there and not yet written goes out on the same socket
 * ahead of this, so pi reads what is on screen — see saves.ts.
 */
function submit(
	form: HTMLFormElement,
	text: string,
	behavior: "followUp" | "steer",
	front: string | null,
	chosen: ChosenWords | null,
	files: { url?: string; mediaType?: string; filename?: string }[] = [],
): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	const images = imagesOf(files);
	flushSaves();
	// A first word that names a command on the list pi sent is one, and pi is
	// told so; any other "/" is a character. See commandMenu.ts.
	const command = namesCommand(commandsStore.get(), trimmed);
	// Where an earlier question is being asked again, its place in the session
	// tree rides along: the server moves the leaf to just before it and sends
	// this from there, so the two are alternatives rather than a sequence.
	const asking = askingAgainStore.get();
	send({
		type: "prompt",
		text: trimmed,
		...(front ? { front } : {}),
		// What was chosen in the note, for this turn: pi is told what the
		// question is about, and the words stay out of the message itself.
		...(chosen && chosen.path === front ? { chosen: chosen.text, ...(chosen.page ? { page: chosen.page } : {}) } : {}),
		...(command ? { command } : {}),
		...(images.length ? { images } : {}),
		behavior,
		...(asking ? { entryId: asking.entryId } : {}),
	});
	askingAgainStore.set(null);
	form.reset();
	draftStore.set("");
	return true;
}

/**
 * A note that what is in the box will replace an earlier question rather than
 * follow it, and the way to change your mind. Dropping it leaves the text
 * where it is: it was copied in, and taking it back out is not what cancelling
 * means here.
 */
function AskingAgain() {
	const asking = useSyncExternalStore(askingAgainStore.subscribe, askingAgainStore.get);
	if (!asking) return null;

	return (
		<div className="mb-2 flex items-center gap-1.5 text-xs text-subtle-foreground">
			<PencilIcon className="size-3 shrink-0" />
			<span className="min-w-0 flex-1 truncate">Asking again: {asking.text}</span>
			<Button
				variant="ghost"
				size="icon-xs"
				className="size-4 rounded-sm"
				onClick={() => askingAgainStore.set(null)}
				aria-label="Send as a new question instead"
			>
				<X />
			</Button>
		</div>
	);
}

/**
 * The tab in front, over the box, as it goes beside the message: what kind of
 * thing it is, the name the tab row calls it by, and the words chosen in it —
 * one thing, which part of which file, so one line. Linear's agent says the
 * issue it is open on the same way, on a card a size larger than the box,
 * over its top edge.
 *
 * It appears with the tab and goes with it; the words appear by being chosen
 * and go by being unchosen. Turned off (FrontToggle), it stays, faded, so
 * what is not going is still said.
 *
 * Keyed by the tab (Composer), so another tab rises in as a step does at the
 * foot of the window (.step-in) — and choosing words, which is the same tab,
 * does not. Still with motion reduced; the fade when it is turned off stays.
 */
function Front({ label, chosen, off }: { label: FrontLabel; chosen: ChosenWords | null; off: boolean }) {
	return (
		<div id="front" data-kind={label.kind} data-off={off || undefined} className="step-in flex min-w-0 items-center gap-1.5 px-2.5 pt-1.5 pb-2 text-sm transition-opacity duration-150 data-[off]:opacity-50">
			<FrontMark label={label} />
			{"id" in label && <span className="shrink-0 text-muted-foreground tabular-nums">{label.id}</span>}
			{label.name !== null && <span className="min-w-0 shrink truncate">{label.name}</span>}
			{label.kind === "task" && label.name === null && <span className="min-w-0 shrink truncate">Task {label.id}</span>}
			{chosen && (
				<span id="chosen" className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground" title={chosen.text}>
					<TextQuoteIcon className="size-3.5 shrink-0" />
					{/* Where in a PDF: its pages are the only address the words have. */}
					{chosen.page && <span className="shrink-0">p. {chosen.page}</span>}
					<span className="min-w-0 truncate">{chosen.text}</span>
				</span>
			)}
		</div>
	);
}

/**
 * Whether the tab in front goes with the message: lit while it does, as
 * Linear's is. Off for one tab only — see Composer.
 */
function FrontToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<InputGroupButton
					id="front-toggle"
					variant="ghost"
					size="icon-sm"
					aria-label={on ? "Do not send what is in front" : "Send what is in front"}
					aria-pressed={on}
					className="rounded-full aria-pressed:bg-accent aria-pressed:text-foreground"
					onClick={onToggle}
				>
					<ScanIcon className="size-4" />
				</InputGroupButton>
			</TooltipTrigger>
			<TooltipContent side="top">{on ? "The agent is told what is in front — press to leave it out" : "Tell the agent what is in front"}</TooltipContent>
		</Tooltip>
	);
}

/**
 * What was pasted into the box, above it, each with the way to take it back
 * out. Images only: those are what ride with a message, since pi's models
 * read them. Any other file goes into the folder and is named in the text
 * instead — see `take` in Composer.
 */
function Attached() {
	const attachments = usePromptInputAttachments();
	if (attachments.files.length === 0) return null;
	return (
		<PromptInputHeader id="attached">
			{attachments.files.map((f) => (
				<span key={f.id} className="relative inline-flex">
					<img src={f.url} alt={f.filename ?? "pasted image"} className="size-12 rounded-sm border object-cover" />
					<Button
						variant="secondary"
						size="icon-xs"
						className="absolute -top-1.5 -right-1.5 size-4 rounded-full"
						onClick={() => attachments.remove(f.id)}
						aria-label="Do not send this image"
					>
						<X />
					</Button>
				</span>
			))}
		</PromptInputHeader>
	);
}

/**
 * Where you write to pi.
 *
 * What to do with a message typed mid-run used to be a dropdown, which asked
 * for the decision permanently and before there was anything to decide about.
 * Nobody does it that way: ChatGPT will not take the message at all, and the
 * agents that will — Cursor, Claude Code — make it a gesture on the key you
 * press. So it is one here too, and only while a run is going.
 */
export function Composer({ front }: { front: string | null }) {
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	const config = useSyncExternalStore(configStore.subscribe, configStore.get);
	const streaming = config?.isStreaming ?? false;
	// The tab in front goes beside the message unless it is turned off, and
	// only that tab: another in front is on again, since what was turned off
	// was that one (Claude Code's × on its file does the same).
	const specs = useSyncExternalStore(specsStore.subscribe, specsStore.get);
	const label = front ? frontLabel(specs, front) : null;
	const [off, setOff] = useState<string | null>(null);
	useEffect(() => setOff(null), [front]);
	const going = label && off !== front ? front : null;
	// What the editor points at in that tab, going and faded with it.
	const chosen = useSyncExternalStore(chosenStore.subscribe, chosenStore.get);
	const pointing = chosen && chosen.path === front ? chosen : null;

	// Text a cleared queue handed back. The box is uncontrolled — PromptInput
	// reads it out of the form on submit — so it is written directly, appended
	// rather than assigned so it cannot overwrite something half-typed.
	const box = useRef<HTMLTextAreaElement>(null);
	// What the box holds and where the cursor is, kept beside it for the
	// lists: the box is uncontrolled, so these follow it rather than drive it.
	const [text, setText] = useState(() => draftStore.get());
	const [caret, setCaret] = useState(0);
	const commands = useSyncExternalStore(commandsStore.subscribe, commandsStore.get);
	const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
	const documents = useSyncExternalStore(documentsStore.subscribe, documentsStore.get);
	// Escape puts the list away for the text as it stands; typing brings it back.
	const [dismissed, setDismissed] = useState<string | null>(null);
	const [selected, setSelected] = useState("");
	// Every send goes through the form, since that is where pasted images are
	// turned into something that can be sent; the key that steers says so
	// here first, and the form's submit reads it once.
	const steering = useRef(false);
	// Sent, the box is reset by the form, which fires no change: the mirror is
	// emptied by hand.
	const send_ = (form: HTMLFormElement, value: string, files: { url?: string; mediaType?: string; filename?: string }[]) => {
		const behavior = steering.current ? "steer" : "followUp";
		steering.current = false;
		if (submit(form, value, behavior, going, going ? pointing : null, files)) setText("");
	};
	// A file that is not an image, dropped or pasted: it goes where the message
	// box's files are kept (.octave/attachments, out of git) and its path into
	// the message, where the cursor is, as a mention — the
	// box is read when the answer comes, since the person may have typed on.
	// The form below still sees the same event and takes the images from it.
	const [adding, setAdding] = useState<string[]>([]);
	const take = (list: FileList | undefined | null) => {
		for (const file of filesToAttach(list ?? [])) {
			setAdding((names) => [...names, file.name]);
			attach(file, { to: "message" })
				.then((path) => {
					const el = box.current;
					if (!el) return;
					const next = insertMention(el.value, el.selectionStart, path);
					write(next.text, next.cursor);
				})
				.catch((err: Error) => applyServerEvent({ type: "error", message: `Could not add ${file.name}: ${err.message}` }))
				.finally(() => setAdding((names) => names.filter((n, i) => i !== names.indexOf(file.name))));
		}
	};
	const write = (value: string, cursor = value.length) => {
		if (!box.current) return;
		box.current.value = value;
		box.current.setSelectionRange(cursor, cursor);
		draftStore.set(value);
		setText(value);
		setCaret(cursor);
		box.current.focus();
	};
	// One list at most: a command being named (the whole box is "/word"), else
	// a note being named (the word at the cursor is "@word"). Each says what
	// it offers and what taking a row does; the keys below are the same.
	const command = commandQuery(text);
	const mention = mentionQuery(text, caret);
	let list: { id: string; items: Suggestion[]; pick: (value: string) => void } | null = null;
	if (dismissed !== text && command !== null) {
		list = {
			id: "commands",
			items: matchCommands(commands, command).map((c) => ({
				value: c.name,
				label: `/${c.name}`,
				detail: c.description,
				tag: SOURCE[c.source],
			})),
			pick: (name) => write(acceptCommand(name)),
		};
	} else if (dismissed !== text && mention !== null) {
		list = {
			id: "mentions",
			// The documents after the notes: a PDF is named the way a note is, and
			// its title keeps its extension, which is how the row says what it is.
			items: matchNotes([...files.map((f) => f.path), ...documents], mention.query)
				.slice(0, NOTES_OFFERED)
				.map((path) => ({ value: path, label: titleOf(path), detail: folderOf(path) })),
			pick: (path) => {
				const next = acceptMention(text, mention.from, caret, path);
				write(next.text, next.cursor);
			},
		};
	}
	const offered = list?.items ?? [];
	const current = offered.find((s) => s.value === selected) ?? offered[0];
	// What was typed before this box was made, if it was made again elsewhere
	// — see draft.ts. Written in, not given as a default: a form reset goes
	// back to the default, and a sent message must leave the box empty.
	useEffect(() => {
		if (box.current) box.current.value = draftStore.get();
	}, []);
	const restored = useSyncExternalStore(restoredStore.subscribe, restoredStore.get);
	useEffect(() => {
		if (!restored || !box.current) return;
		write(appendRestored(box.current.value, restored));
		restoredStore.set(null);
	}, [restored]);

	const submitButton = (
		// Sends whatever pi is doing. At rest it sends, and the arrow goes up.
		// Mid-run the message joins the queue — the same thing Enter does — and
		// the arrow is Enter's own, so the icon says which of the two a press
		// will be. Holding the key that steers while clicking steers, as it does
		// on Enter; the ref is read by the form's submit.
		//
		// The name is said as well as drawn: the arrow and the words on hovering
		// it are for people who can see them, and a screen reader is read the
		// label alone — which said "Submit" mid-run, the one thing a press then
		// does not do.
		//
		// In the window's ink, not its accent: it is on screen the whole time,
		// and the accent is kept for what is pressed, turned on, focused or
		// followed — the one solid colour always showing would be this, and it
		// would say nothing. Linear's reply button is the same, and round, as
		// this one is: the one control in the box that is not a line of text.
		<PromptInputSubmit
			className="rounded-full bg-foreground text-background hover:bg-foreground/90"
			aria-label={streaming ? "Queue" : "Submit"}
			// Off while there is nothing to send, which is what submit() already
			// holds: a button that looks pressable and does nothing is the one
			// thing a control must not be.
			disabled={!online || !text.trim()}
			status="ready"
			onClick={(e) => {
				if (streaming && (e.metaKey || e.ctrlKey)) steering.current = true;
			}}
		>
			{streaming ? <CornerDownLeftIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
		</PromptInputSubmit>
	);

	return (
		// The footer gives up its words as the panel narrows, and what it has to
		// fit in is this box — not the window, which pi's column is only a
		// draggable share of. So the measure is a container query, taken here,
		// where the width the footer actually gets is settled. The strip at the
		// foot of the window measures itself the same way, for the controls that
		// used to be along this row.
		<div className="@container/composer p-3">
			<QueuedMessages />
			<AskingAgain />
			{/* The list sits over the box's top edge, so it is placed from out here:
			    the box clips what is inside it (overflow-hidden), and a list drawn
			    inside was there and could not be seen. */}
			<div className="relative" onDropCapture={(e) => take(e.dataTransfer?.files)} onPasteCapture={(e) => take(e.clipboardData?.files)}>
			{list && (
				<SuggestMenu id={list.id} items={list.items} selected={current?.value ?? ""} onSelect={setSelected} onPick={list.pick} />
			)}
			{/* A card a size larger than the box, the tab in front along its top
			    edge: drawn only while there is a tab to say. It grows out into the
			    panel's padding — by its own border and padding, 5px — rather than
			    into the box, so the box keeps the width and the place it has without
			    it, in line with everything else in the panel. */}
			<div className={label ? "-mx-[5px] -mb-[5px] rounded-lg border bg-muted/40 p-1" : undefined}>
			{label && <Front key={front} label={label} chosen={pointing} off={going === null} />}
			<PromptInput accept="image/*" onSubmit={(message, event) => send_(event.currentTarget, message.text, message.files)}>
				<Attached />
				{adding.length > 0 && (
					<PromptInputHeader id="adding" className="text-xs text-muted-foreground">
						Adding {adding.join(", ")} to the folder…
					</PromptInputHeader>
				)}
				<PromptInputBody>
					{/* The component asks for four lines of empty box; one is enough until
					    there is something to show, and it grows from there. */}
					<PromptInputTextarea
						ref={box}
						className="min-h-9"
						placeholder="Message the agent"
						disabled={!online}
						onChange={(e) => {
							draftStore.set(e.currentTarget.value);
							setText(e.currentTarget.value);
							setCaret(e.currentTarget.selectionStart);
						}}
						// Where the cursor is, for the word it is at the end of. Fires on
						// every move of it, keys and mouse alike.
						onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
						onKeyDown={(e) => {
							// While rows are offered, the keys that move through a list are
							// the list's: up and down choose, Enter and Tab take, Escape
							// puts it away. Anything else types on.
							if (list && current && !e.nativeEvent.isComposing) {
								const at = offered.indexOf(current);
								const step = (n: number) => setSelected(offered[(at + n + offered.length) % offered.length]!.value);
								if (e.key === "ArrowDown") return void (e.preventDefault(), step(1));
								if (e.key === "ArrowUp") return void (e.preventDefault(), step(-1));
								if (e.key === "Enter" || e.key === "Tab") return void (e.preventDefault(), list.pick(current.value));
								if (e.key === "Escape") return void (e.preventDefault(), setDismissed(text));
							}
							// Steering is delivered at the next turn boundary — after the
							// current turn's tool calls, before the next model call — so it
							// cuts a tool-using run short. Enter alone queues instead.
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
								e.preventDefault();
								steering.current = true;
								e.currentTarget.form!.requestSubmit();
							}
						}}
					/>
				</PromptInputBody>
				<PromptInputFooter>
					<PromptInputTools>
						{/* Chosen per message, so it sits with the message. What pi may
						    reach for while it answers is not chosen per message and is no
						    longer here: the tool mode and the context ring are in the
						    strip at the foot of the window, under pi's own column. */}
						{config && (
							<ModelPicker
								model={config.model}
								models={config.models}
								notice={config.modelsNotice}
								disabled={!online}
							/>
						)}
						{/* What used to be here, when there was something to say: that the
						    socket was down, or that the agent was waiting on an answer. Both
						    are in the strip at the foot of the window now. They were said
						    beside the box they disable, which was the right place until the
						    column could be folded away — and the moment you most need to be
						    told the agent is waiting for you is the moment you have put its
						    column away and gone back to writing. */}
					</PromptInputTools>
					{/* Never shrunk. Without this the row's only flexible item is this
					    one, and its children — which are not flexible — get squeezed out
					    of it and drawn over the controls on the left. */}
					<span className="flex shrink-0 items-center gap-1">
						{label && <FrontToggle on={going !== null} onToggle={() => setOff(going ? front : null)} />}
						{/* Stopping is its own button rather than the sending one wearing
						    another hat, and it belongs beside what it is the opposite of.
						    Quiet where that one is solid, so two buttons this close are
						    not mistaken for each other, and type="button": Enter presses
						    the form's first submit button, which must be the other one. */}
						{streaming && (
							<Tooltip>
								<TooltipTrigger asChild>
									<InputGroupButton
										variant="ghost"
										size="icon-sm"
										aria-label="Stop"
										onClick={() => send({ type: "abort" })}
									>
										<SquareIcon className="size-4" />
									</InputGroupButton>
								</TooltipTrigger>
								<TooltipContent side="top">Stop the run — what the agent has already done stays</TooltipContent>
							</Tooltip>
						)}
						{/* What the two keys do is said on the button they are an
						    alternative to, and only while a run makes them mean anything.
						    It used to be a line of words on the left of this row, which
						    explained a button at the other end of it and took the width a
						    narrow panel needed for the controls. */}
						{streaming ? (
							<Tooltip>
								<TooltipTrigger asChild>{submitButton}</TooltipTrigger>
								<TooltipContent side="top">
									Joins the queue — the agent takes it when this run ends. {MOD}↵ sends it now and cuts the run short.
								</TooltipContent>
							</Tooltip>
						) : (
							submitButton
						)}
					</span>
				</PromptInputFooter>
			</PromptInput>
			</div>
			</div>
		</div>
	);
}
