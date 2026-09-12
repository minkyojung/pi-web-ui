import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EditorView } from "@codemirror/view";

import { cardPlaces, draftIn, setDraft, type Draft } from "../features/cards";
import { flushSaves } from "../saves";
import { askDoneStore, cardsStore } from "../serverState";
import type { Card } from "../types";
import { send } from "../ws";

/** Between two cards that would otherwise sit on top of each other. */
const GAP = 8;

/**
 * The cards down the right of a note, each beside the words it was opened on.
 *
 * A card is not in the note, so it is not in the editor either: this is a
 * column of its own, and each card is put at the height of its words by asking
 * CodeMirror where they are on screen. Two cards that would overlap are pushed
 * down in turn, as Notion and Google Docs push comments down — the first one
 * keeps its place, and the rest follow.
 *
 * Where the words are is the editor's answer, not the server's: the server
 * says where a card sits in the text it last saw, and the marks in the editor
 * have moved through everything typed since.
 */
export function Cards({
	view,
	path,
	draft,
	moved,
	onDraft,
}: {
	view: EditorView | null;
	path: string;
	/** The card being written, if any. Its place is the editor's; its words are here. */
	draft: Draft | null;
	/** Bumped whenever the text under the cards moved: scrolled, typed, written. */
	moved: number;
	onDraft: (draft: Draft | null) => void;
}) {
	const sent = useSyncExternalStore(cardsStore.subscribe, cardsStore.get);
	const done = useSyncExternalStore(askDoneStore.subscribe, askDoneStore.get);
	const column = useRef<HTMLDivElement>(null);
	const boxes = useRef(new Map<string, HTMLDivElement>());
	const [asked, setAsked] = useState<{ id: number; card: string } | null>(null);
	const cards = sent?.path === path ? sent.cards : [];

	// The draft's words were taken out from under it while it was being written.
	const here = view ? draftIn(view.state) : null;
	useEffect(() => {
		if (draft && view && !here) onDraft(null);
	}, [draft, here, view, onDraft]);

	// The server has the card now, and draws it with everything it knows.
	useEffect(() => {
		if (draft && cards.some((c) => c.id === draft.id)) {
			view?.dispatch({ effects: setDraft.of(null) });
			onDraft(null);
			setAsked(null);
		}
	}, [cards, draft, view, onDraft]);

	// An ask that never became a card: pi was busy, or the words had gone.
	const refused = asked && done?.id === asked.id && !cards.some((c) => c.id === asked.card) ? done.outcome : null;

	const places = view ? cardPlaces(view.state) : new Map<string, { from: number; to: number }>();
	const shown = cards.filter((c) => !c.resolved);
	const ordered: { key: string; at: number; card?: Card }[] = [
		...shown.map((card) => ({ key: card.id, at: places.get(card.id)?.from ?? card.from, card })),
		...(draft && here ? [{ key: draft.id, at: here.from }] : []),
	].sort((a, b) => a.at - b.at);

	// Each card at the height of its words, and the ones after it pushed clear.
	// After the paint that drew them, so their heights are the real ones.
	useLayoutEffect(() => {
		const box = column.current?.getBoundingClientRect();
		if (!view || !box) return;
		let floor = 0;
		for (const { key, at } of ordered) {
			const el = boxes.current.get(key);
			if (!el) continue;
			const coords = view.coordsAtPos(Math.min(at, view.state.doc.length));
			// Off the top or bottom of what is drawn: so is its card.
			if (!coords) {
				el.style.visibility = "hidden";
				continue;
			}
			const top = Math.max(coords.top - box.top, floor);
			el.style.visibility = "visible";
			el.style.transform = `translateY(${top}px)`;
			floor = top + el.offsetHeight + GAP;
		}
	});

	const keep = (key: string) => (el: HTMLDivElement | null) => {
		if (el) boxes.current.set(key, el);
		else boxes.current.delete(key);
	};

	const ask = (text: string) => {
		if (!draft || !view) return;
		const id = (asked?.id ?? 0) + 1;
		setAsked({ id, card: draft.id });
		// What is typed and not yet written down goes first, so the places this
		// names are places in the note the server has.
		flushSaves();
		send({ type: "prompt", text, note: path, ask: { id, path, from: draft.from, to: draft.to, card: draft.id } });
	};

	const drop = () => {
		view?.dispatch({ effects: setDraft.of(null) });
		onDraft(null);
		setAsked(null);
		view?.focus();
	};

	if (ordered.length === 0) return null;
	return (
		<div id="cards" ref={column} className="relative w-72 shrink-0 overflow-hidden border-l bg-background">
			{ordered.map(({ key, card }) => (
				<div key={key} ref={keep(key)} className="absolute left-0 top-0 w-full px-3" style={{ visibility: "hidden" }}>
					{card ? (
						<Written card={card} path={path} onGo={() => reveal(view, places.get(card.id) ?? card)} />
					) : (
						<Writing quote={draft?.quote ?? ""} waiting={asked !== null} refused={refused} onAsk={ask} onDrop={drop} />
					)}
				</div>
			))}
		</div>
	);
}

/** Put the words a card is about back on screen, and in the selection. */
function reveal(view: EditorView | null, at: { from: number; to: number }): void {
	if (!view || at.from >= at.to) return;
	view.dispatch({ selection: { anchor: at.from, head: at.to }, scrollIntoView: true });
	view.focus();
}

const shell = "rounded-md border bg-background p-2.5 text-xs shadow-sm";

/** A card with its question sent: waiting, answered, or with a reason there is no answer. */
function Written({ card, path, onGo }: { card: Card; path: string; onGo: () => void }) {
	const act = (type: "place_card" | "resolve_card" | "delete_card") => send({ type, path, card: card.id });
	return (
		<div className={shell}>
			{card.orphaned && (
				<p className="mb-1.5 text-muted-foreground">The words this was about are gone.</p>
			)}
			<button type="button" onClick={onGo} className="block w-full cursor-default text-left leading-relaxed">
				{card.question}
			</button>
			{card.answer ? (
				<p className="mt-2 whitespace-pre-wrap leading-relaxed text-muted-foreground">{card.answer.text}</p>
			) : card.failed ? (
				<p className="mt-2 text-muted-foreground">{reasons[card.failed]}</p>
			) : (
				<p className="mt-2 text-muted-foreground">…</p>
			)}
			<div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
				{card.answer && !card.placed && !card.orphaned && (
					<button type="button" onClick={() => act("place_card")} className="cursor-default rounded-sm px-1 hover:bg-accent hover:text-foreground">
						Put in note
					</button>
				)}
				{card.placed && <span className="px-1">In the note</span>}
				{card.answer && (
					<button type="button" onClick={() => act("resolve_card")} className="cursor-default rounded-sm px-1 hover:bg-accent hover:text-foreground">
						Resolve
					</button>
				)}
				<button type="button" onClick={() => act("delete_card")} className="ml-auto cursor-default rounded-sm px-1 hover:bg-accent hover:text-foreground">
					Delete
				</button>
			</div>
		</div>
	);
}

const reasons: Record<NonNullable<Card["failed"]>, string> = {
	interrupted: "Stopped before pi answered.",
	gone: "The words this was about had gone.",
	failed: "pi had no answer.",
};

/** A card with nothing sent yet: the box the question is written in. */
function Writing({
	quote,
	waiting,
	refused,
	onAsk,
	onDrop,
}: {
	quote: string;
	waiting: boolean;
	refused: string | null;
	onAsk: (text: string) => void;
	onDrop: () => void;
}) {
	const box = useRef<HTMLTextAreaElement>(null);
	useEffect(() => box.current?.focus(), []);
	return (
		<div className={shell}>
			<p className="line-clamp-2 text-muted-foreground">{quote}</p>
			<textarea
				ref={box}
				rows={2}
				placeholder="Ask pi about this"
				className="mt-1.5 w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted-foreground"
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						onDrop();
					}
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						const text = e.currentTarget.value.trim();
						if (text) onAsk(text);
					}
				}}
			/>
			{refused ? (
				<p className="text-muted-foreground">
					{refused === "interrupted" ? "pi is busy. Ask again when it is done." : "Could not ask about this."}
				</p>
			) : waiting ? (
				<p className="text-muted-foreground">…</p>
			) : (
				<p className="text-[11px] text-muted-foreground">⏎ to ask · esc to drop</p>
			)}
		</div>
	);
}
