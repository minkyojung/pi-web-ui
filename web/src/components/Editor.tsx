import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, ChangeSet, EditorState, type Extension, Transaction } from "@codemirror/state";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { drawSelection, dropCursor, EditorView, keymap, placeholder, scrollPastEnd } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { choose, chosenStore } from "../chosen";
import { linkCompletion } from "../features/linkCompletion";
import { listIndent } from "../features/listIndent";
import { livePreview } from "../features/livePreview";
import { landOn, links, notesChanged } from "../features/links";
import { pending, setSpans } from "../features/pending";
import { toggleMarks } from "../features/toggleMarks";
import { comeBack, leave, scrollBack } from "../features/viewMemory";
import { frontMatter } from "../../../frontmatter.ts";
import { highlightTag, highlight } from "../../../highlight.ts";
import { wikiLink } from "../../../wikilink.ts";
import type { Place } from "../../../links.ts";
import { backlinksStore, filesStore, noteChangedStore, noteConflictStore, noteGoneStore, noteStore } from "../serverState";
import { titleOf } from "../noteSync";
import { applyChanges, changeSetOf, decide, rebase } from "../noteSync";
import { registerSave } from "../saves";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";

/** How long typing has to stop before it is written down. */
const AUTOSAVE_MS = 600;

/** Marks a change the server made, so it is not taken for typing and saved back. */
const fromServer = Annotation.define<boolean>();
/**
 * On every change the server makes: not typing, and not undoable. ⌘Z undoes
 * what the person typed; what pi or another editor wrote is not theirs to
 * take back that way, and an undo that reached it would then be saved as a
 * change of theirs.
 */
const serverChange = [fromServer.of(true), Transaction.addToHistory.of(false)];

/**
 * The editor in the app's own colours, both themes, since the tokens switch
 * with data-theme and this reads them. Markdown is drawn as markdown — weight
 * and slant, one monospace for code — rather than in colours: this is a note,
 * not a program, and the one colour that will mean something here is the one
 * that says who wrote a word.
 */
const theme = EditorView.theme({
	"&": { height: "100%", backgroundColor: "var(--background)", color: "var(--foreground)", fontSize: "15px" },
	".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6", padding: "1.5rem 0" },
	".cm-content": { maxWidth: "42rem", margin: "0 auto", padding: "0 1.5rem", caretColor: "var(--foreground)" },
	".cm-line": { padding: "0" },
	"&.cm-focused": { outline: "none" },
	".cm-cursor": { borderLeftColor: "var(--foreground)" },
	// Not --accent: in the light theme that is nearly the page colour, and a
	// selection that cannot be seen is not one. A share of the text colour
	// reads in both themes.
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
		backgroundColor: "color-mix(in oklab, var(--foreground) 18%, transparent)",
	},
	".cm-placeholder": { color: "var(--muted-foreground)" },
	// ==words==: a wash of the text colour, like the selection but lighter, so it reads in both themes.
	".cm-highlight": { backgroundColor: "color-mix(in oklab, var(--foreground) 12%, transparent)", borderRadius: "2px" },
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
	// Drawn by the editor now, so ::selection is left to the browser's default.
	".cm-selectionMatch": { backgroundColor: "color-mix(in oklab, var(--foreground) 10%, transparent)" },
});

const markup = HighlightStyle.define([
	{ tag: tags.heading, fontWeight: "600" },
	{ tag: tags.heading1, fontSize: "1.4em" },
	{ tag: tags.heading2, fontSize: "1.2em" },
	{ tag: tags.emphasis, fontStyle: "italic" },
	{ tag: tags.strong, fontWeight: "600" },
	{ tag: tags.strikethrough, textDecoration: "line-through" },
	{ tag: highlightTag, class: "cm-highlight" },
	{ tag: tags.link, textDecoration: "underline", color: "var(--muted-foreground)" },
	{ tag: tags.url, color: "var(--muted-foreground)" },
	{ tag: tags.monospace, fontFamily: "ui-monospace, monospace", fontSize: "0.9em" },
	{ tag: tags.processingInstruction, color: "var(--muted-foreground)" },
	{ tag: tags.quote, color: "var(--muted-foreground)" },
	{ tag: tags.meta, color: "var(--muted-foreground)" },
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
	extensions = [],
	onOpen,
}: {
	path: string;
	/** Where the link that opened this note pointed inside it, if anywhere. */
	place?: Place | null;
	extensions?: Extension[];
	/** Follow a link: open another note, at a place in it. */
	onOpen?: (path: string, place?: Place) => void;
}) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	/** Landed on once, when the text first arrives: after that the cursor is the person's. */
	const landing = useRef(place);
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
	/**
	 * Work that changes the doc, held while the person is mid-composition —
	 * a Hangul syllable half typed — since a transaction then would cut the
	 * composition short. Run in order once it ends.
	 */
	const held = useRef<(() => void)[]>([]);
	const whenNotComposing = (fn: () => void) => {
		const v = view.current;
		if (!v) return;
		held.current.push(fn);
		if (held.current.length > 1) return; // A tick is already waiting.
		const tick = () => {
			const view_ = view.current;
			if (!view_) return void (held.current = []);
			if (view_.composing) return void setTimeout(tick, 40);
			const jobs = held.current;
			held.current = [];
			for (const job of jobs) job();
		};
		tick();
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
			pending(() => at.current),
			links({
				notes: () => filesStore.get().map((f) => f.path),
				here: () => at.current,
				open: (p, at) => onOpen?.(p, at),
			}),
			linkCompletion(() => filesStore.get().map((f) => f.path)),
			// Markup hidden where the cursor is not; Mod-e shows it all again.
			livePreview,
			toggleMarks,
			// Wrapped list lines start where the item's words do. Outside the
			// compartment: source mode wants this too.
			listIndent,
		];
		const state = EditorState.create({
			doc: "",
			extensions: [
				history(),
				// Order is precedence. The markdown keys go before the default ones
				// or Enter would never reach them: a list item continues on Enter
				// and ends on a second, a quote likewise. closeBrackets' Backspace
				// takes the pair out together; it too has to see the key first.
				keymap.of([
					{ key: "Mod-s", run: () => (save(), true) },
					indentWithTab,
					...markdownKeymap,
					...closeBracketsKeymap,
					...searchKeymap,
					...defaultKeymap,
					...historyKeymap,
				]),
				// No HTML tag completion: a `<` in prose is a less-than, not a tag.
				markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [wikiLink, frontMatter, highlight], completeHTMLTags: false }),
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
				scrollPastEnd(),
				placeholder("Write here"),
				EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": "Note" }),
				theme,
				EditorView.updateListener.of((u) => {
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
		const onHide = () => save();
		addEventListener("pagehide", onHide);
		return () => {
			save();
			// Only a note whose text came is a note that was left somewhere:
			// StrictMode runs this once right after mount, over an empty doc.
			if (base.current !== null) leave(at.current, v);
			removeEventListener("pagehide", onHide);
			unregister();
			// Nothing is chosen in a note that is not open.
			chosenStore.set(null);
			v.destroy();
			view.current = null;
		};
		// Once: a rename changes `path` without changing which note this is.
		// `extensions` is a stable array from the caller.
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
					v.dispatch({ effects: setSpans.of({ spans: note.spans }) });
				} else {
					// The echo of the save; what was typed since is still owed.
					saved.current = note.text;
					base.current = note.modified;
					local.current = sinceSent.current;
					sent.current = null;
					dirty.current = !local.current.empty;
					setStatus(dirty.current ? "unsaved" : "saved");
					v.dispatch({ effects: setSpans.of({ spans: note.spans, through: local.current }) });
				}
				return;
			case "same":
				settle(note.text, note.modified);
				v.dispatch({ effects: setSpans.of({ spans: note.spans }) });
				return;
			case "replace": {
				// The first text of a note opened again: back where it was left,
				// unless a link said where to land. Later whole texts keep the
				// cursor where it is, if the text still reaches there.
				const first = base.current === null;
				const back = first && !landing.current ? comeBack(path, note.text.length) : null;
				v.dispatch({
					changes: { from: 0, to: v.state.doc.length, insert: note.text },
					annotations: serverChange,
					selection: back ?? { anchor: Math.min(v.state.selection.main.head, note.text.length) },
					effects: setSpans.of({ spans: note.spans }),
				});
				if (back) scrollBack(path, v);
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
			v.dispatch({ effects: setSpans.of({ spans: changed.spans, through: local.current }) });
			return;
		}
		if (!dirty.current) {
			v.dispatch({ changes: theirs, annotations: serverChange, effects: setSpans.of({ spans: changed.spans }) });
			settle(text, changed.modified);
			return;
		}
		const fit = rebase(theirs, local.current);
		if (!fit) {
			setStatus("conflict");
			return;
		}
		// Their change, around the typing; the typing, over their text.
		v.dispatch({ changes: fit.theirs, annotations: serverChange, effects: setSpans.of({ spans: changed.spans, through: fit.ours }) });
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
		<div id="editor" className="flex min-h-0 flex-1 flex-col" data-status={status}>
			{status === "conflict" && (
				<div role="alert" className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs">
					<span className="flex-1">This note changed on disk while you were editing it.</span>
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={reload}>
						Reload
					</Button>
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={overwrite}>
						Keep mine
					</Button>
				</div>
			)}
			{status === "gone" && (
				<div role="alert" className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs">
					<span className="flex-1">This note is no longer on disk. What is here is the only copy.</span>
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={overwrite}>
						Put it back
					</Button>
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={close}>
						Close
					</Button>
				</div>
			)}
			<div ref={host} className="min-h-0 flex-1 overflow-hidden" />
			<Backlinks path={path} onOpen={onOpen} />
		</div>
	);
}

/**
 * The notes that link here, under the note. From the index, sent with the
 * note and again whenever a write anywhere may have changed it. Nothing when
 * there are none: an empty "Linked from" is a question nobody asked.
 */
function Backlinks({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
	const all = useSyncExternalStore(backlinksStore.subscribe, backlinksStore.get);
	const notes = all[path] ?? [];
	if (notes.length === 0) return null;
	return (
		<div id="backlinks" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-6 py-2 text-xs text-muted-foreground">
			<span>Linked from</span>
			{notes.map((b) => (
				<button
					key={b.path}
					type="button"
					title={b.path}
					onClick={() => onOpen?.(b.path)}
					className="cursor-default rounded-sm px-1 text-foreground hover:bg-accent"
				>
					{titleOf(b.path)}
					{b.count > 1 && <span className="ml-1 text-muted-foreground">{b.count}</span>}
				</button>
			))}
		</div>
	);
}
