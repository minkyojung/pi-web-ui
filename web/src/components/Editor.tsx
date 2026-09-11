import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, ChangeSet, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { pending, setSpans } from "../features/pending";
import { noteChangedStore, noteConflictStore, noteStore } from "../serverState";
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
export function Editor({ path, extensions = [] }: { path: string; extensions?: Extension[] }) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
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
	const [status, setStatus] = useState<"loading" | "saved" | "unsaved" | "conflict">("loading");

	const save = () => {
		const v = view.current;
		if (!v || !dirty.current) return false;
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		const text = v.state.doc.toString();
		// Only a save that went out is one to expect an echo of. One sent to a
		// closed socket is dropped, and the doc stays dirty for the next chance.
		if (send({ type: "save_note", path, text, base: base.current })) {
			sent.current = text;
			sinceSent.current = ChangeSet.empty(text.length);
		}
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
					if (u.docChanged && !u.transactions.some((t) => t.annotation(fromServer))) onChange(u.changes);
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

	// The note whole: the answer to open_note, and the fallback for a change
	// on a version this editor does not have.
	const note = useSyncExternalStore(noteStore.subscribe, noteStore.get);
	useEffect(() => {
		const v = view.current;
		if (!v || !note || note.path !== path) return;
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
					v.dispatch({ effects: setSpans.of({ spans: note.spans, through: local.current }) });
				}
				return;
			case "same":
				settle(note.text, note.modified);
				v.dispatch({ effects: setSpans.of({ spans: note.spans }) });
				return;
			case "replace":
				v.dispatch({
					changes: { from: 0, to: v.state.doc.length, insert: note.text },
					annotations: fromServer.of(true),
					// Keep the cursor where it was if the text still reaches there.
					selection: { anchor: Math.min(v.state.selection.main.head, note.text.length) },
					effects: setSpans.of({ spans: note.spans }),
				});
				settle(note.text, note.modified);
				return;
			case "conflict":
				setStatus("conflict");
				return;
		}
	}, [note, path]);

	// A change to the note, from whoever made it, over the version it was made to.
	const changed = useSyncExternalStore(noteChangedStore.subscribe, noteChangedStore.get);
	useEffect(() => {
		const v = view.current;
		if (!v || !changed || changed.path !== path || base.current === null) return;
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
			v.dispatch({ changes: theirs, annotations: fromServer.of(true), effects: setSpans.of({ spans: changed.spans }) });
			settle(text, changed.modified);
			return;
		}
		const fit = rebase(theirs, local.current);
		if (!fit) {
			setStatus("conflict");
			return;
		}
		// Their change, around the typing; the typing, over their text.
		v.dispatch({ changes: fit.theirs, annotations: fromServer.of(true), effects: setSpans.of({ spans: changed.spans, through: fit.ours }) });
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
			stale.current = true;
			save();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [changed, path]);

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
