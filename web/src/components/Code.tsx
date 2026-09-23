import { useEffect, useRef, useSyncExternalStore } from "react";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers } from "@codemirror/view";

import { choose, chosenStore } from "../chosen";
import { code } from "../codeLook";
import { isRunLog, stuckToEnd } from "../logTail";
import { say as sayInFront } from "../inFront";
import { codeStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";

const theme = EditorView.theme({
	// A height, unlike the note's editor: there is no title and no backlinks
	// above this, so the file is what scrolls and it scrolls in here.
	"&": { backgroundColor: "var(--background)", color: "var(--foreground)", fontSize: "13px", height: "100%" },
	".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.65", overflow: "auto" },
	".cm-content": { padding: "0.75rem 0" },
	// The numbers are the one thing in the margin, and they are for finding a
	// line somebody named rather than for reading, so they sit back.
	".cm-gutters": { backgroundColor: "var(--background)", color: "var(--muted-foreground)", border: "none" },
	".cm-lineNumbers .cm-gutterElement": { padding: "0 0.75rem 0 1rem", minWidth: "3ch" },
	".cm-activeLine": { backgroundColor: "transparent" },
	".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
	"&.cm-focused": { outline: "none" },
	".cm-panels.cm-panels-top": { position: "sticky", top: 0, zIndex: 10 },
	".cm-cursor": { borderLeftColor: "var(--foreground)" },
	// The same long selectors the note's editor needs, and for the same reason
	// — CodeMirror's base theme reaches this element through five classes.
	"&.cm-editor .cm-selectionLayer .cm-selectionBackground": { background: "var(--selection)" },
	"&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "var(--selection)" },
});

/**
 * A file of the repository, read in the middle column.
 *
 * Read-only rather than uneditable: the state refuses a change, and the view
 * stays focusable and selectable, which is what keeps ⌘F, the keyboard and
 * choosing words working. A file here is the agent's work to look at, and
 * changing it is the agent's job or another editor's — Octave writes notes
 * and specs, and a second way to write code would be a second editor to keep.
 *
 * The text comes from the server (`open_code`) rather than from `/vault/`,
 * which gives out only pictures and documents, and comes again whenever the
 * file changes on disk, so a tab left open on a file a task is writing is
 * never showing yesterday's.
 *
 * Its language is loaded when the file names one — `@codemirror/language-data`
 * fetches the grammar for that one language — so a repository of Rust does not
 * carry the cost of every other.
 */
export default function Code({ path }: { path: string }) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const language = useRef(new Compartment());
	const answer = useSyncExternalStore(codeStore.subscribe, codeStore.get);
	// The store holds the last answer whatever it was for: a message about the
	// file that was open a moment ago is not this tab's news.
	const mine = answer?.path === path ? answer : null;

	// Asked again when the socket comes back: the server keeps nothing for a
	// tab that was away, and the file may have been written while it was. The
	// ask is a watch too, so leaving says so — a window that has moved on to a
	// note should not be sent a file it is not showing.
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	useEffect(() => {
		if (!online) return;
		send({ type: "open_code", path });
		return () => {
			send({ type: "close_code" });
		};
	}, [online, path]);

	useEffect(() => {
		if (!host.current) return;
		const made = new EditorView({
			parent: host.current,
			state: EditorState.create({
				extensions: [
					EditorState.readOnly.of(true),
					lineNumbers(),
					language.current.of([]),
					syntaxHighlighting(code),
					drawSelection(),
					highlightSelectionMatches(),
					// ⌘F is the editor's here as it is in a note (App.tsx); the panel
					// is at the top so the text does not jump under it.
					search({ top: true }),
					keymap.of(searchKeymap),
					EditorView.contentAttributes.of({ "aria-label": path, "aria-readonly": "true" }),
					theme,
					// What is chosen, for the box above pi's column — the same gesture
					// as in a note and in a PDF, so a line of code can be asked about.
					// And which line the cursor is on, which is where the editor this
					// file is handed to should open it (NoteHeader.tsx).
					EditorView.updateListener.of((u) => {
						if (!u.selectionSet && !u.docChanged) return;
						const { from, to } = u.state.selection.main;
						choose(path, u.state.sliceDoc(from, to));
						sayInFront(path, { line: u.state.doc.lineAt(from).number });
					}),
				],
			}),
		});
		view.current = made;
		return () => {
			// Nothing is chosen in a file that is not open.
			if (chosenStore.get()?.path === path) chosenStore.set(null);
			view.current = null;
			made.destroy();
		};
	}, [path]);

	// The grammar for this file's name, if there is one and once it is here.
	useEffect(() => {
		const found = LanguageDescription.matchFilename(languages, path.slice(path.lastIndexOf("/") + 1));
		if (!found) return;
		let live = true;
		void found.load().then(
			(support) => {
				if (live) view.current?.dispatch({ effects: language.current.reconfigure(support) });
			},
			() => {
				// A grammar that will not load is a file drawn as plain text, which
				// is what it was a moment ago. Nothing to say about it.
			},
		);
		return () => {
			live = false;
		};
	}, [path]);

	// The text, each time the server says what it is — first ask, and every
	// write to it since. Replaced whole: there is nothing here to preserve,
	// and the alternative is the note's change-set machinery for a view that
	// cannot be typed in. A log the commands printed is read at its end, and
	// kept there while it grows unless the reader has scrolled up (logTail.ts).
	useEffect(() => {
		const editor = view.current;
		if (!editor) return;
		const text = mine?.type === "code" ? mine.text : "";
		if (editor.state.doc.toString() === text) return;
		const log = isRunLog(path);
		const follow = log && (editor.state.doc.length === 0 || stuckToEnd(editor.scrollDOM));
		editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
		if (follow) editor.scrollDOM.scrollTop = editor.scrollDOM.scrollHeight;
	}, [mine, path]);

	const gone = mine?.type === "code_gone" ? mine : null;
	return (
		<div id="page" data-code={path} className="edge-top relative flex min-h-0 flex-1 flex-col">
			<div ref={host} className="min-h-0 flex-1 overflow-hidden" />
			{gone && (
				<p className="absolute inset-0 flex items-center justify-center bg-background p-8 text-center text-sm text-subtle-foreground">
					{gone.reason === "binary" ? "Not a text file." : "This file is not in the folder."}
				</p>
			)}
			{mine?.type === "code" && mine.truncated && (
				<p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{isRunLog(path) ? "Too long to show whole — this is the end of it." : "Too long to show whole — this is the beginning of it."}</p>
			)}
		</div>
	);
}
