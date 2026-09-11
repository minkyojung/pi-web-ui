import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { pending, setSpans } from "../features/pending";
import { noteConflictStore, noteStore } from "../serverState";
import { decide } from "../noteSync";
import { registerSave } from "../saves";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Button } from "./ui/button";

/** How long typing has to stop before it is written down. */
const AUTOSAVE_MS = 600;

/** Marks a change the server made, so it is not taken for typing and saved back. */
const fromServer = Annotation.define<boolean>();

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
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent)" },
	".cm-activeLine": { backgroundColor: "transparent" },
});

const markup = HighlightStyle.define([
	{ tag: tags.heading, fontWeight: "600" },
	{ tag: tags.heading1, fontSize: "1.4em" },
	{ tag: tags.heading2, fontSize: "1.2em" },
	{ tag: tags.emphasis, fontStyle: "italic" },
	{ tag: tags.strong, fontWeight: "600" },
	{ tag: tags.strikethrough, textDecoration: "line-through" },
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
 * down when it pauses and on ⌘S, on top of the version it was read at; the
 * server sends the note back after every write from anyone, and noteSync.ts
 * says what to do with each — most often nothing, sometimes show it, and when
 * someone else wrote under unsaved typing, ask.
 *
 * Features are CodeMirror extensions, listed in `features` below; the editor
 * itself is markdown, history and the keymap. A caller can add more.
 */
export function Editor({ path, extensions = [] }: { path: string; extensions?: Extension[] }) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	// The version on disk the doc was read from, the save in flight, and whether
	// the doc has moved past what is saved. Refs: they change on every keystroke.
	const base = useRef<number | null>(null);
	const sent = useRef<string | null>(null);
	const dirty = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [status, setStatus] = useState<"loading" | "saved" | "unsaved" | "conflict">("loading");

	const save = () => {
		const v = view.current;
		if (!v || !dirty.current) return false;
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		const text = v.state.doc.toString();
		// Only a save that went out is one to expect an echo of. One sent to a
		// closed socket is dropped, and the doc stays dirty for the next chance.
		if (send({ type: "save_note", path, text, base: base.current })) sent.current = text;
		return true;
	};

	// Typing: mark dirty and (re)start the clock.
	const onChange = () => {
		dirty.current = true;
		setStatus("unsaved");
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(save, AUTOSAVE_MS);
	};

	useEffect(() => {
		if (!host.current) return;
		const features = [pending(path)];
		const state = EditorState.create({
			doc: "",
			extensions: [
				history(),
				keymap.of([{ key: "Mod-s", run: () => (save(), true) }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
				markdown({ base: markdownLanguage, codeLanguages: languages }),
				syntaxHighlighting(markup),
				EditorView.lineWrapping,
				theme,
				EditorView.updateListener.of((u) => {
					if (u.docChanged && !u.transactions.some((t) => t.annotation(fromServer))) onChange();
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
		// The write barrier, in its three forms: before a prompt (whoever sends
		// one calls flushSaves), before the page goes, and before this box does.
		const unregister = registerSave(save);
		const onHide = () => save();
		addEventListener("pagehide", onHide);
		return () => {
			save();
			removeEventListener("pagehide", onHide);
			unregister();
			v.destroy();
			view.current = null;
		};
		// `extensions` is a stable array from the caller; `save` closes over `path`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [path]);

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

	// The note, from whoever wrote it.
	const note = useSyncExternalStore(noteStore.subscribe, noteStore.get);
	useEffect(() => {
		const v = view.current;
		if (!v || !note || note.path !== path) return;
		const doc = v.state.doc.toString();
		const decision = base.current === null && sent.current === null
			? { kind: "replace" as const } // The first answer to open_note.
			: decide({ doc, sent: sent.current, dirty: dirty.current }, note);
		// Who wrote what is about the server's text; it is only put on the doc
		// when the doc is that text. Typing since then gets it with the next echo.
		const spans = () => v.dispatch({ effects: setSpans.of(note.spans) });
		switch (decision.kind) {
			case "saved":
				sent.current = null;
				base.current = note.modified;
				dirty.current = decision.dirty;
				setStatus(decision.dirty ? "unsaved" : "saved");
				if (!decision.dirty) spans();
				return;
			case "same":
				base.current = note.modified;
				spans();
				return;
			case "replace":
				v.dispatch({
					changes: { from: 0, to: v.state.doc.length, insert: note.text },
					annotations: fromServer.of(true),
					// Keep the cursor where it was if the text still reaches there.
					selection: { anchor: Math.min(v.state.selection.main.head, note.text.length) },
					effects: setSpans.of(note.spans),
				});
				base.current = note.modified;
				dirty.current = false;
				setStatus("saved");
				return;
			case "conflict":
				setStatus("conflict");
				return;
		}
	}, [note, path]);

	// A save of ours the server refused: the same situation as above.
	const conflict = useSyncExternalStore(noteConflictStore.subscribe, noteConflictStore.get);
	useEffect(() => {
		if (conflict && conflict.path === path) {
			sent.current = null;
			setStatus("conflict");
		}
	}, [conflict, path]);

	const reload = () => {
		dirty.current = false;
		sent.current = null;
		noteConflictStore.set(null);
		send({ type: "open_note", path });
	};
	const overwrite = () => {
		// On top of whatever is there now: the server said what that is, or the
		// note we last saw did.
		base.current = conflict?.path === path ? conflict.modified : (note?.path === path ? note.modified : base.current);
		dirty.current = true;
		noteConflictStore.set(null);
		save();
	};

	return (
		<div id="editor" className="flex h-full flex-col" data-status={status}>
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
			<div ref={host} className="min-h-0 flex-1 overflow-hidden" />
		</div>
	);
}
