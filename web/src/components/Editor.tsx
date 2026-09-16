import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { ChangeSet, EditorState, type Extension, Transaction } from "@codemirror/state";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { drawSelection, dropCursor, EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { choose, chosenStore } from "../chosen";
import { linkCompletion } from "../features/linkCompletion";
import { indentListItem, listBackspace, listEnter, outdentListItem } from "../features/listEdit";
import { listNumbers } from "../features/listNumbers";
import { listIndent } from "../features/listIndent";
import { authors, clearAuthors, paintAuthors, registerPutBack, showAuthorsStore } from "../features/authors";
import { livePreview, toggleLivePreview, toggleTask } from "../features/livePreview";
import { leaveTextUp } from "../features/pageMove";
import { properties, propertiesField } from "../features/properties";
import { fromServer, serverChange } from "../features/origin";
import { landOn, links, notesChanged } from "../features/links";
import { closeDiff, diffFor, keepChunk, review, showDiff, undoChunk } from "../features/review";
import { toggleBold, toggleItalic } from "../features/toggleMarks";
import { fitted, leaving, scrollBack } from "../features/viewPlace";
import { wrapSelection } from "../features/wrapSelection";
import { highlightTag } from "../../../highlight.ts";
import { inlineCodeTag, noteSyntax } from "../../../syntax.ts";
import { bodyStart, type Properties as PropertiesRead } from "../../../properties.ts";
import { tagTag } from "../../../tag.ts";
import type { Place } from "../../../links.ts";
import type { Left } from "../nav";
import type { Backlink, Tagged } from "../types";
import { authorsStore, backlinksStore, filesStore, noteChangedStore, noteConflictStore, noteGoneStore, noteStore, taggedStore } from "../serverState";
import { titleOf } from "../noteSync";
import { applyChanges, changeSetOf, decide, rebase } from "../noteSync";
import { flushSaves, registerSave } from "../saves";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Properties } from "./Properties";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** How long typing has to stop before it is written down. */
const AUTOSAVE_MS = 600;

/**
 * The editor in the app's own colours, both themes, since the tokens switch
 * with data-theme and this reads them. Markdown is drawn as markdown — weight
 * and slant, one monospace for code — rather than in colours: this is a note,
 * not a program, and the one colour that will mean something here is the one
 * that says who wrote a word.
 */
const theme = EditorView.theme({
	// No height: the editor is as tall as its text, and the page (#note) scrolls.
	"&": { backgroundColor: "var(--background)", color: "var(--foreground)", fontSize: "15px" },
	// The margin around the text is the scroller's, and the column is the
	// content element with no padding of its own: the selection is drawn as
	// wide as .cm-content, so any padding on it is painted as selected past
	// the words. This is how Obsidian has it. 39rem is the title's 42rem box
	// less its own 1.5rem sides, so the two start on one line.
	".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6", padding: "1.5rem" },
	// The find panel stays in view while the page scrolls under it.
	".cm-panels.cm-panels-top": { position: "sticky", top: 0, zIndex: 10 },
	".cm-content": { maxWidth: "39rem", margin: "0 auto", padding: "0", caretColor: "var(--foreground)" },
	".cm-line": { padding: "0" },
	"&.cm-focused": { outline: "none" },
	".cm-cursor": { borderLeftColor: "var(--foreground)" },
	// --selection, so a note is marked the way the rest of the window is; the
	// themes decide what that is.
	//
	// The selectors are the long way round on purpose. CodeMirror's base theme
	// reaches this element through `&light.cm-focused > .cm-scroller >
	// .cm-selectionLayer .cm-selectionBackground` — five classes — so the short
	// `&.cm-focused .cm-selectionBackground` loses on specificity and the
	// selection came out CodeMirror's lavender in every theme, whatever was
	// written here. Matching its path and adding one class wins without
	// !important.
	"&.cm-editor .cm-selectionLayer .cm-selectionBackground": { background: "var(--selection)" },
	"&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
		background: "var(--selection)",
	},
	".cm-placeholder": { color: "var(--muted-foreground)" },
	// ==words==: a wash of the text colour, like the selection but lighter, so it reads in both themes.
	".cm-highlight": { backgroundColor: "color-mix(in oklab, var(--foreground) 12%, transparent)", borderRadius: "2px" },
	// #tag: set off from the prose the way a link is, without being one yet.
	// The fill is --muted rather than a wash mixed here, so that it and the
	// words on it are a pair the themes answer for — a wash of --foreground
	// under text taken from --muted-foreground is two colours derived apart
	// and met on screen, and on a light page they met at 4.2. It is also the
	// fill every other quiet chip in the window already uses.
	".cm-tag": { color: "var(--muted-foreground)", backgroundColor: "var(--muted)", borderRadius: "4px", padding: "0 0.25em" },
	// The search panel, in the app's own chrome rather than CodeMirror's grey.
	".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)" },
	".cm-panels-top": { borderBottom: "1px solid var(--border)" },
	".cm-panel.cm-search": { padding: "0.4rem 1.5rem", fontSize: "12px" },
	".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search .cm-button": {
		backgroundImage: "none",
		fontFamily: "inherit",
		fontSize: "12px",
		color: "var(--foreground)",
		backgroundColor: "transparent",
		border: "1px solid var(--border)",
		borderRadius: "0.375rem",
		padding: "0.15rem 0.4rem",
		margin: "0 0.25rem 0.25rem 0",
	},
	".cm-panel.cm-search button:hover, .cm-panel.cm-search .cm-button:hover": { backgroundColor: "var(--accent)" },
	".cm-panel.cm-search .cm-button:active": { backgroundImage: "none", backgroundColor: "var(--accent)" },
	".cm-panel.cm-search label": { fontSize: "12px", color: "var(--muted-foreground)", marginRight: "0.5rem" },
	".cm-panel.cm-search [name=close]": { color: "var(--muted-foreground)", border: "none", fontSize: "16px", top: "0.3rem", right: "1rem" },
	".cm-searchMatch": { backgroundColor: "color-mix(in oklab, var(--foreground) 14%, transparent)" },
	".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in oklab, var(--foreground) 28%, transparent)" },
	// The other copies of the selected word, under the selection's own wash.
	".cm-selectionMatch": { backgroundColor: "color-mix(in oklab, var(--foreground) 10%, transparent)" },
});

const markup = HighlightStyle.define([
	{ tag: tags.heading, fontWeight: "600" },
	{ tag: tags.heading1, fontSize: "1.4em" },
	{ tag: tags.heading2, fontSize: "1.2em" },
	{ tag: tags.heading3, fontSize: "1.1em" },
	{ tag: tags.heading4, fontSize: "1em" },
	{ tag: tags.heading5, fontSize: "0.95em" },
	{ tag: tags.heading6, fontSize: "0.9em", color: "var(--muted-foreground)" },
	{ tag: tags.emphasis, fontStyle: "italic" },
	{ tag: tags.strong, fontWeight: "600" },
	{ tag: tags.strikethrough, textDecoration: "line-through" },
	{ tag: highlightTag, class: "cm-highlight" },
	{ tag: tagTag, class: "cm-tag" },
	{ tag: tags.link, textDecoration: "underline", color: "var(--muted-foreground)" },
	{ tag: tags.url, color: "var(--muted-foreground)" },
	{ tag: tags.monospace, fontFamily: "ui-monospace, monospace", fontSize: "0.9em" },
	// Inline code in a box; the font again, since this rule is the one taken for it.
	{
		tag: inlineCodeTag,
		fontFamily: "ui-monospace, monospace",
		fontSize: "0.9em",
		backgroundColor: "color-mix(in oklab, var(--foreground) 7%, transparent)",
		borderRadius: "3px",
		padding: "0.1em 0.3em",
	},
	{ tag: tags.processingInstruction, color: "var(--muted-foreground)" },
	{ tag: tags.quote, color: "var(--muted-foreground)" },
	{ tag: tags.meta, color: "var(--muted-foreground)" },
	// %%a note to self%%: there, but plainly not part of the note.
	{ tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic", class: "cm-comment" },
]);

/**
 * One note, in CodeMirror.
 *
 * Uncontrolled, for the reason the composer is: a keystroke must not re-render
 * anything outside this box. The view lives in a ref and React sees only the
 * few words of status under it.
 *
 * The disk is the truth and this is a short-lived copy of it. Typing is written
 * down when it pauses and on ⌘S, on top of the version it was read at. After
 * every write from anyone the server sends the change that was made, over the
 * version it was made to: on that version it is applied where it falls, and
 * the cursor stays put; under typing the server has not seen it is fitted
 * around the typing when the two do not touch, and put to the person when
 * they do; on any other version the note is asked for whole. noteSync.ts holds
 * the decisions, so they can be pinned without a browser.
 *
 * Features are CodeMirror extensions, listed in `features` below; the editor
 * itself is markdown, history and the keymap. A caller can add more.
 */
export function Editor({
	path,
	place = null,
	left = null,
	onLeave,
	extensions = [],
	onOpen,
}: {
	path: string;
	/** Where the link that opened this note pointed inside it, if anywhere. */
	place?: Place | null;
	/** Where this step of the way back was being read, if it was read before. */
	left?: Left | null;
	/** Where it is being read now: called as the note is stepped off, for the step to keep. */
	onLeave?: (left: Left) => void;
	extensions?: Extension[];
	/** Follow a link: open another note, at a place in it. */
	onOpen?: (path: string, place?: Place) => void;
}) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	/** The page (#note) the editor scrolls on: the title and backlinks scroll with the text. */
	const page = useRef<HTMLElement | null>(null);
	/** Landed on once, when the text first arrives: after that the cursor is the person's. */
	const landing = useRef(place);
	/** Where this step was read before, for the same one arrival. */
	const was = useRef(left);
	/**
	 * Told as the note is stepped off, from a cleanup that runs while the step
	 * this editor was drawn for is still the one in front: a component being
	 * taken off the page is not rendered again, so this is its own step's and
	 * not the one being opened.
	 */
	const report = useRef(onLeave);
	report.current = onLeave;
	// The path can change under a live editor — a rename — so what the closures
	// below send is read from here, not captured at mount.
	const at = useRef(path);
	at.current = path;
	// The version on disk the doc was read from, the save in flight, and whether
	// the doc has moved past what is saved. Refs: they change on every keystroke.
	const base = useRef<number | null>(null);
	/** The server's text at `base`: what the doc was before typing, and what a change from the server is over. */
	const saved = useRef("");
	/** Typing since `base`, as one change set — what a change from the server has to fit around. */
	const local = useRef(ChangeSet.empty(0));
	/** Typing since the save in flight went out, which is what is left once its echo lands. */
	const sinceSent = useRef(ChangeSet.empty(0));
	const sent = useRef<string | null>(null);
	/** A refusal is expected for a save already overtaken here; it is not a conflict. */
	const stale = useRef(false);
	const dirty = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [status, setStatus] = useState<"loading" | "saved" | "unsaved" | "conflict" | "gone">("loading");
	/** The properties as the editor last read them, for the panel; a new value only when the block changed. */
	const [read, setRead] = useState<PropertiesRead | null>(null);
	/**
	 * Work that changes the doc, held while the person is mid-composition —
	 * a Hangul syllable half typed — since a transaction then would drop
	 * what the input method has put in the DOM and not yet handed over.
	 * Run in order once the composition is over: the editor's next update
	 * after it, which the composition's own commit brings (the listener
	 * below), on a microtask, since nothing may be dispatched inside one.
	 */
	const held = useRef<(() => void)[]>([]);
	const whenNotComposing = (fn: () => void) => {
		const v = view.current;
		if (!v) return;
		if (v.composing) held.current.push(fn);
		else fn();
	};
	const releaseHeld = () => {
		const jobs = held.current;
		held.current = [];
		queueMicrotask(() => {
			if (!view.current) return;
			for (const job of jobs) job();
		});
	};

	const save = () => {
		const v = view.current;
		if (!v || !dirty.current) return false;
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		const text = v.state.doc.toString();
		// Only a save that went out is one to expect an echo of. One sent to a
		// closed socket is dropped, and the doc stays dirty for the next chance.
		if (!send({ type: "save_note", path: at.current, text, base: base.current })) return false;
		sent.current = text;
		sinceSent.current = ChangeSet.empty(text.length);
		return true;
	};

	// Typing: remember it, mark dirty and (re)start the clock.
	const onChange = (changes: ChangeSet) => {
		local.current = local.current.compose(changes);
		sinceSent.current = sinceSent.current.compose(changes);
		dirty.current = true;
		setStatus("unsaved");
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(save, AUTOSAVE_MS);
	};

	/** The doc is the server's text `text` at version `modified`: nothing typed, nothing owed. */
	const settle = (text: string, modified: number) => {
		saved.current = text;
		base.current = modified;
		local.current = ChangeSet.empty(text.length);
		sinceSent.current = local.current;
		sent.current = null;
		stale.current = false;
		dirty.current = false;
		setStatus("saved");
	};

	useEffect(() => {
		if (!host.current) return;
		const features = [
			// What pi changed and the person has not decided about, as a diff.
			review(() => at.current),
			// Who wrote which words, when the note's menu asks for it; a click on
			// one of them asks how it got there.
			authors(() => at.current),
			links({
				notes: () => filesStore.get().map((f) => f.path),
				here: () => at.current,
				open: (p, at) => onOpen?.(p, at),
			}),
			linkCompletion(() => filesStore.get().map((f) => f.path)),
			// Markup hidden where the cursor is not; Mod-e shows it all again.
			livePreview,
			// The properties read off the tree for the panel above, and the
			// block kept from the cursor and from typing while it is hidden.
			properties,
			// Wrapped list lines start where the item's words do. Outside the
			// compartment: source mode wants this too.
			listIndent,
			// A numbered list's numbers put right on every edit of it.
			listNumbers,
			// A mark typed over chosen words wraps them.
			wrapSelection,
		];
		const state = EditorState.create({
			doc: "",
			extensions: [
				history(),
				// Every key of the editor, in one place and one order: order is
				// precedence, and a command that says no passes the key on. The
				// features' keys go before the default ones, which would take
				// them — Mod-Enter for a blank line, Enter for a plain newline,
				// Backspace for a character.
				keymap.of([
					{ key: "Mod-s", run: () => (save(), true) },
					// Mod-Enter is a decision where there is one to make, and a tick
					// where there is a box: the diff's chunk under the cursor first,
					// then a task on the line. Mod-Backspace takes the chunk back.
					{ key: "Mod-Enter", run: keepChunk },
					{ key: "Mod-Enter", run: toggleTask },
					{ key: "Mod-Backspace", run: undoChunk },
					// Before the search panel's Escape, which would take it while a diff is open.
					{ key: "Escape", run: closeDiff },
					// At the top of the text there is nothing above to move to, and
					// the note's page goes on above: the properties, the title.
					{ key: "ArrowUp", run: leaveTextUp },
					// ⌘[ and ⌘] are the window's back and forward (App.tsx), as in
					// Obsidian. Taken here so the default keymap does not indent with
					// them, which is Tab's work and done above.
					{ key: "Mod-[", run: () => true },
					{ key: "Mod-]", run: () => true },
					{ key: "Mod-e", run: toggleLivePreview },
					{ key: "Mod-b", run: toggleBold },
					{ key: "Mod-i", run: toggleItalic },
					// On a list item, the item is the unit: it nests, splits and ends
					// (listEdit.ts). Elsewhere these say no, and a quote's `>` is
					// lang-markdown's, as is a Tab.
					{ key: "Tab", run: indentListItem },
					{ key: "Shift-Tab", run: outdentListItem },
					{ key: "Enter", run: listEnter },
					{ key: "Enter", run: insertNewlineContinueMarkup },
					{ key: "Backspace", run: listBackspace },
					{ key: "Backspace", run: deleteMarkupBackward },
					indentWithTab,
					...closeBracketsKeymap,
					...searchKeymap,
					...defaultKeymap,
					...historyKeymap,
				]),
				// No HTML tag completion: a `<` in prose is a less-than, not a tag.
				// And not the language's own Enter and Backspace, which it would put
				// above every key bound here: the list ones are above.
				markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [noteSyntax], completeHTMLTags: false, addKeymap: false }),
				// Four spaces, as Typora and GitHub have it and as Obsidian's tab
				// counts: what a Tab inserts, and enough to nest under `1. ` or
				// `10. `, which two would not be.
				indentUnit.of("    "),
				// Pairs close as they open. Backticks too, for inline code; not
				// `*`, which opens a list item as often as it opens emphasis, and
				// `[[` needs nothing — the second `[` lands inside the first pair.
				closeBrackets(),
				markdownLanguage.data.of({ closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] } }),
				syntaxHighlighting(markup),
				EditorView.lineWrapping,
				// The selection and cursor drawn by the editor rather than the
				// browser, which is what lets there be more than one of each.
				drawSelection(),
				EditorState.allowMultipleSelections.of(true),
				dropCursor(),
				highlightSelectionMatches(),
				// ⌘F, find next and previous, replace: the editor's own panel, at
				// the top so the text does not jump, drawn in the app's tokens below.
				search({ top: true }),
				placeholder("Write here"),
				EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": "Note" }),
				theme,
				EditorView.updateListener.of((u) => {
					if (held.current.length > 0 && !u.view.composing) releaseHeld();
					if (u.state.field(propertiesField) !== u.startState.field(propertiesField)) setRead(u.state.field(propertiesField));
					if (u.docChanged && !u.transactions.some((t) => t.annotation(fromServer))) onChange(u.changes);
					// What is chosen, for the box under pi's column to point with.
					if (u.selectionSet || u.docChanged) {
						const { from, to } = u.state.selection.main;
						choose(at.current, u.state.sliceDoc(from, to));
					}
				}),
				...features,
				...extensions,
			],
		});
		const v = new EditorView({ state, parent: host.current });
		view.current = v;
		// The page this editor scrolls on, found while it is still on it.
		page.current = host.current.closest("#note");
		setRead(v.state.field(propertiesField));
		base.current = null;
		sent.current = null;
		dirty.current = false;
		setStatus("loading");
		// A note opened is a note about to be typed in — unless the person was
		// mid-sentence to pi, whose box is not to be taken from under them.
		const active = document.activeElement;
		if (!(active instanceof HTMLTextAreaElement) && !(active instanceof HTMLInputElement)) v.focus();
		// The write barrier, in its three forms: before a prompt (whoever sends
		// one calls flushSaves), before the page goes, and before this box does.
		const unregister = registerSave(save);
		// Putting pi's words back, from the card that says what they replaced.
		const unregisterPutBack = registerPutBack((from, to, text) => v.dispatch({ changes: { from, to, insert: text }, userEvent: "input" }));
		const onHide = () => save();
		addEventListener("pagehide", onHide);
		return () => {
			save();
			removeEventListener("pagehide", onHide);
			unregister();
			unregisterPutBack();
			// Nothing is chosen in a note that is not open.
			chosenStore.set(null);
			v.destroy();
			view.current = null;
		};
		// Once: a rename changes `path` without changing which note this is.
		// `extensions` is a stable array from the caller.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Where the note is left — cursor and scroll — is read here, in a layout
	// effect's cleanup, which runs while the editor is still on the page. By
	// the time the effect above is cleaned up the page has lost this editor,
	// and with it the height that held its scroll. Only a note whose text
	// came is a note that was left somewhere: StrictMode runs this once right
	// after mount, over an empty doc.
	useLayoutEffect(() => {
		return () => {
			if (view.current && base.current !== null) report.current?.(leaving(view.current, page.current));
		};
	}, []);

	// Asked for whenever there is a socket to ask on: at mount the socket may
	// not be up yet — a reload lands here before it reconnects — and after an
	// outage the note may have moved, which the answer settles the usual way.
	//
	// Typing done while the socket was down is sent first: it lands if the note
	// did not move meanwhile, and is refused into the conflict banner if it did.
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	useEffect(() => {
		if (!online) return;
		save();
		send({ type: "open_note", path });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [online, path]);

	// A note made or renamed elsewhere may be the one a link here names.
	const notes = useSyncExternalStore(filesStore.subscribe, filesStore.get);
	useEffect(() => {
		view.current?.dispatch({ effects: notesChanged.of(null) });
	}, [notes]);

	// The note whole: the answer to open_note, and the fallback for a change
	// on a version this editor does not have.
	const note = useSyncExternalStore(noteStore.subscribe, noteStore.get);
	useEffect(() => {
		if (!view.current || !note || note.path !== path) return;
		whenNotComposing(() => {
		const v = view.current!;
		const doc = v.state.doc.toString();
		const decision = base.current === null && sent.current === null
			? { kind: "replace" as const } // The first answer to open_note.
			: decide({ doc, sent: sent.current, dirty: dirty.current }, note);
		switch (decision.kind) {
			case "saved":
				if (!decision.dirty) {
					settle(note.text, note.modified);
					v.dispatch({ effects: diffFor(note.original ?? null) });
				} else {
					// The echo of the save; what was typed since is still owed.
					saved.current = note.text;
					base.current = note.modified;
					local.current = sinceSent.current;
					sent.current = null;
					dirty.current = !local.current.empty;
					setStatus(dirty.current ? "unsaved" : "saved");
					v.dispatch({ effects: diffFor(note.original ?? null) });
				}
				return;
			case "same":
				settle(note.text, note.modified);
				v.dispatch({ effects: diffFor(note.original ?? null) });
				return;
			case "replace": {
				// The first text of a note opened again: back where it was left,
				// unless a link said where to land; a note never left opens under
				// its properties, where its text begins. Later whole texts keep
				// the cursor where it is, if the text still reaches there.
				const first = base.current === null;
				const back = first && !landing.current && was.current ? fitted(was.current, note.text.length) : null;
				v.dispatch({
					changes: { from: 0, to: v.state.doc.length, insert: note.text },
					annotations: serverChange,
					selection: back ?? { anchor: first ? bodyStart(note.text) : Math.min(v.state.selection.main.head, note.text.length) },
					effects: diffFor(note.original ?? null),
				});
				if (back) scrollBack(was.current!, v, page.current);
				settle(note.text, note.modified);
				if (landing.current) {
					landOn(v, landing.current);
					landing.current = null;
				}
				return;
			}
			case "conflict":
				setStatus("conflict");
				return;
		}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [note, path]);

	// Turned on from the note's menu: what is unsaved goes down first, since the
	// answer is about the note on disk, and then the question is asked. Turned
	// off, or moved to another note, the marks go at once rather than waiting
	// for an answer about somewhere else.
	const showAuthors = useSyncExternalStore(showAuthorsStore.subscribe, showAuthorsStore.get);
	useEffect(() => {
		const v = view.current;
		if (!v) return;
		v.dispatch({ effects: clearAuthors.of(null) });
		if (!showAuthors) return;
		flushSaves();
		send({ type: "who_wrote", path });
	}, [showAuthors, path]);

	const authored = useSyncExternalStore(authorsStore.subscribe, authorsStore.get);
	useEffect(() => {
		const v = view.current;
		if (!v || !showAuthors || authored?.path !== path) return;
		v.dispatch({ effects: paintAuthors.of(authored.spans) });
	}, [authored, showAuthors, path]);

	// A change to the note, from whoever made it, over the version it was made to.
	const changed = useSyncExternalStore(noteChangedStore.subscribe, noteChangedStore.get);
	useEffect(() => {
		if (!view.current || !changed || changed.path !== path) return;
		whenNotComposing(() => {
		const v = view.current!;
		if (base.current === null) return;
		if (changed.base !== base.current) {
			// Not a version this editor has — a change missed while offline, or
			// one already past. The language-server answer: ask for the whole.
			send({ type: "open_note", path });
			return;
		}
		const text = applyChanges(saved.current, changed.changes);
		const theirs = changeSetOf(changed.changes, saved.current.length);
		if (sent.current !== null && text === sent.current) {
			// The echo of this editor's save, as the change it made.
			saved.current = text;
			base.current = changed.modified;
			local.current = sinceSent.current;
			sent.current = null;
			dirty.current = !local.current.empty;
			setStatus(dirty.current ? "unsaved" : "saved");
			v.dispatch({ effects: diffFor(changed.original ?? null) });
			return;
		}
		if (!dirty.current) {
			v.dispatch({ changes: theirs, annotations: serverChange, effects: diffFor(changed.original ?? null) });
			settle(text, changed.modified);
			return;
		}
		const fit = rebase(theirs, local.current);
		if (!fit) {
			setStatus("conflict");
			return;
		}
		// Their change, around the typing; the typing, over their text.
		v.dispatch({ changes: fit.theirs, annotations: serverChange, effects: diffFor(changed.original ?? null) });
		saved.current = text;
		base.current = changed.modified;
		local.current = fit.ours;
		sinceSent.current = fit.ours;
		if (sent.current !== null) {
			// A save is on its way over the old version, and the server will
			// refuse it: it wrote theirs first, or this change would not have
			// come on this version. Everything typed is over their text now, so
			// it is sent again on that, and the refusal on its way is not news.
			sent.current = null;
			// Only a save that went out has a refusal coming. One that did not
			// — the socket down — leaves nothing to ignore, and the latch must
			// not stay set to swallow a real refusal later.
			stale.current = save();
		}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [changed, path]);

	// The diff is about one note. Opening another closes it; the other's own
	// `note` opens its own, if there is anything in it to decide about.
	useEffect(() => () => { if (view.current) showDiff(view.current, null); }, [path]);

	// The note is gone from the disk: deleted by pi's bash, another program,
	// or a save that found nothing to save over. What is on screen is the only
	// copy; the person decides whether it goes back.
	const gone = useSyncExternalStore(noteGoneStore.subscribe, noteGoneStore.get);
	useEffect(() => {
		if (!gone || gone.path !== path) return;
		noteGoneStore.set(null);
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		sent.current = null;
		stale.current = false;
		setStatus("gone");
	}, [gone, path]);

	// A save of ours the server refused: the same situation as above.
	const conflict = useSyncExternalStore(noteConflictStore.subscribe, noteConflictStore.get);
	useEffect(() => {
		if (!conflict || conflict.path !== path) return;
		if (stale.current) {
			stale.current = false;
			noteConflictStore.set(null);
			return;
		}
		sent.current = null;
		setStatus("conflict");
	}, [conflict, path]);

	/** Take the disk's version. Everything typed here is given up, and the answer settles the rest. */
	const reload = () => {
		const v = view.current;
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		dirty.current = false;
		sent.current = null;
		stale.current = false;
		local.current = ChangeSet.empty(v?.state.doc.length ?? 0);
		sinceSent.current = local.current;
		noteConflictStore.set(null);
		send({ type: "open_note", path });
	};
	/** Put what is on screen over whatever is there — the version the refusal named, or none if the note is gone. */
	const overwrite = () => {
		if (status === "gone") base.current = null;
		else if (conflict?.path === path) base.current = conflict.modified;
		else if (note?.path === path) base.current = note.modified;
		else return reload(); // No version to write over is known here; the disk's answer will say.
		dirty.current = true;
		noteConflictStore.set(null);
		save();
	};
	const close = () => {
		location.hash = "";
	};

	return (
		<div id="editor" data-status={status}>
			{status === "conflict" && (
				<div role="alert" className="sticky top-0 z-10 flex items-center gap-2 bg-muted px-4 py-2 text-xs">
					<span className="flex-1">This note changed on disk while you were editing it.</span>
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={reload}>
						Reload
					</Button>
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={overwrite}>
						Keep mine
					</Button>
				</div>
			)}
			{/* Above the text, on the page with it: the panel for the block the text hides. Not before the text is here — an empty note is not a note with no properties yet. */}
			{status !== "loading" && <Properties view={view.current} read={read} />}
			{status === "gone" && (
				<div role="alert" className="sticky top-0 z-10 flex items-center gap-2 bg-muted px-4 py-2 text-xs">
					<span className="flex-1">This note is no longer on disk. What is here is the only copy.</span>
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={overwrite}>
						Put it back
					</Button>
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={close}>
						Close
					</Button>
				</div>
			)}
			<div ref={host} />
			<NoteMeta path={path} onOpen={onOpen} />
		</div>
	);
}

/**
 * What the vault knows about the note, under the note: who links here, and
 * who shares its tags. One block, because they are one thing — the note has
 * ended and this is about it. The space above says so; there used to be a
 * rule, and a second one between these two rows, which said the same thing
 * twice about two halves of one aside.
 *
 * Nothing at all when there is neither, and each row gone when there is none
 * of its own: an empty "Linked from" is a question nobody asked.
 */
function NoteMeta({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
	const backlinks = useSyncExternalStore(backlinksStore.subscribe, backlinksStore.get)[path] ?? [];
	const tagged = useSyncExternalStore(taggedStore.subscribe, taggedStore.get)[path] ?? [];
	if (backlinks.length === 0 && tagged.length === 0) return null;
	return (
		<div className="mt-6 flex shrink-0 flex-col gap-1 px-6 pb-2 text-xs text-muted-foreground">
			<Backlinks notes={backlinks} onOpen={onOpen} />
			<TaggedWith notes={tagged} onOpen={onOpen} />
		</div>
	);
}

/**
 * The notes that link here. From the index, sent with the note and again
 * whenever a write anywhere may have changed it.
 */
function Backlinks({ notes, onOpen }: { notes: Backlink[]; onOpen?: (path: string) => void }) {
	if (notes.length === 0) return null;
	return (
		<div id="backlinks" className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span>Linked from</span>
			{notes.map((b) => (
				<Tooltip key={b.path}>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="xs" data-path={b.path} className="h-5 cursor-default px-1 font-normal text-foreground" onClick={() => onOpen?.(b.path)}>
							{titleOf(b.path)}
							{b.count > 1 && <span className="text-muted-foreground">{b.count}</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{b.path}</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}

/**
 * The notes that share a tag with this one, beside the backlinks and from the
 * same index: sent with the note, and again whenever a note's tags changed.
 * Each with the tags shared, since that is why it is here.
 */
function TaggedWith({ notes, onOpen }: { notes: Tagged[]; onOpen?: (path: string) => void }) {
	if (notes.length === 0) return null;
	return (
		<div id="tagged" className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span>Tagged with</span>
			{notes.map((t) => (
				<Tooltip key={t.path}>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="xs" data-path={t.path} className="h-5 cursor-default px-1 font-normal text-foreground" onClick={() => onOpen?.(t.path)}>
							{titleOf(t.path)}
							<span className="text-muted-foreground">{t.tags.map((tag: string) => `#${tag}`).join(" ")}</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{t.path}</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}
