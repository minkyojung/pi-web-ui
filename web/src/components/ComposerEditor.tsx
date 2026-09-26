import { type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import { splitBlock } from "@tiptap/pm/commands";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";

import { lineBefore } from "../composer/caret";
import { extensions } from "../composer/schema";
import { CHIP, docToText, textToDoc } from "../composer/text";

/** What the rest of the box does with it, in the text it stands for (composer/text.ts). */
export interface ComposerEditorHandle {
	/** The whole message as text, a chip its `@path`. */
	text(): string;
	/** The files the message names as chips, in order. */
	chips(): string[];
	/** The caret's line up to the caret, and where it starts — see composer/caret.ts. */
	before(): { text: string; start: number };
	/** The whole box, from text; the caret at its end, the focus where it was. */
	setText(text: string): void;
	/** A range replaced by text, or by a file's chip and a space after it; the caret after. */
	replace(from: number, to: number, what: { text: string } | { chip: string }): void;
	/** A file's chip where the caret is, and a space after it. */
	insertChip(path: string): void;
	focus(): void;
	clear(): void;
}

/**
 * The message box itself: a ProseMirror document where a file is a chip in
 * the line (composer/schema.ts), in place of the textarea that was here, and
 * doing what that did — Enter sends, Shift+Enter breaks the line, nothing is
 * sent mid-composition. Files pasted or dropped never reach it: the Composer
 * takes them first and puts their chips in. What it holds is read and written
 * as text (the handle), so the lists, the draft and what is sent are the
 * Composer's as they were.
 *
 * The form still gets the text by name, from a hidden input kept up to date,
 * so PromptInput reads it as it read the textarea.
 */
export function ComposerEditor({
	handle,
	isFile,
	disabled,
	onChange,
	onKeyDown,
}: {
	handle: Ref<ComposerEditorHandle>;
	/** Whether `@path` in text names a file, and so is a chip. */
	isFile: (path: string) => boolean;
	disabled: boolean;
	/** The text and the caret's line, after every change of either. */
	onChange: (text: string, before: { text: string; start: number }) => void;
	/** The Composer's keys first — the lists, steering; true if it took the key. */
	onKeyDown: (event: KeyboardEvent) => boolean;
}) {
	const input = useRef<HTMLInputElement>(null);
	// Read by the editor's handlers, which are made once: a handler made anew
	// on each render would have the editor reconfigured on each render.
	const latest = useRef({ isFile, onChange, onKeyDown });
	latest.current = { isFile, onChange, onKeyDown };

	const report = (editor: Editor) => {
		const text = docToText(editor.getJSON());
		if (input.current) input.current.value = text;
		latest.current.onChange(text, lineBefore(editor.state));
	};

	const editorProps = useMemo(
		() => ({
			attributes: {
				"data-slot": "input-group-control",
				role: "textbox",
				"aria-multiline": "true",
				"aria-label": "Message the agent",
				// A message is not a document to proof: no red underline under a name or a path.
				spellcheck: "false",
				class: "min-h-9 w-full px-3 py-3 text-base whitespace-pre-wrap outline-none md:text-sm",
			},
			handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
				// ProseMirror holds keys back mid-composition already; this is the
				// same promise kept twice, as the textarea kept it.
				if (event.isComposing || event.keyCode === 229) return false;
				if (latest.current.onKeyDown(event)) return true;
				const { state } = view;
				const { empty, $from } = state.selection;
				if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
					event.preventDefault();
					if (event.shiftKey) return splitBlock(state, view.dispatch);
					const form = view.dom.closest("form");
					const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
					if (!submit?.disabled) form?.requestSubmit();
					return true;
				}
				// A chip goes whole, from either side of it.
				if (empty && event.key === "Backspace" && $from.nodeBefore?.type.name === CHIP) {
					view.dispatch(state.tr.delete($from.pos - 1, $from.pos));
					return true;
				}
				if (empty && event.key === "Delete" && $from.nodeAfter?.type.name === CHIP) {
					view.dispatch(state.tr.delete($from.pos, $from.pos + 1));
					return true;
				}
				return false;
			},
			handlePaste: (view: EditorView, event: ClipboardEvent) => {
				const data = event.clipboardData;
				if (!data) return false;
				// Another app's formatting is not a message's: its text only, with
				// `@path` read back into chips. ProseMirror's own copy (data-pm-slice)
				// keeps its chips as they are.
				if (data.getData("text/html").includes("data-pm-slice")) return false;
				const text = data.getData("text/plain");
				if (!text) return false;
				view.dispatch(view.state.tr.replaceSelection(sliceOf(view, text, latest.current.isFile)).scrollIntoView());
				return true;
			},
			handleDrop: (view: EditorView, event: DragEvent) => {
				// Files dropped are the Composer's to take, and it has; ProseMirror
				// would write their address in as text.
				if (!event.dataTransfer?.files.length) return false;
				event.preventDefault();
				return true;
			},
		}),
		[],
	);

	const editor = useEditor({
		extensions,
		editorProps,
		coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: "\n" } },
		onUpdate: ({ editor }) => report(editor),
		onSelectionUpdate: ({ editor }) => report(editor),
	});

	useEffect(() => {
		editor?.setEditable(!disabled);
	}, [editor, disabled]);

	useImperativeHandle(
		handle,
		() => ({
			text: () => (editor ? docToText(editor.getJSON()) : ""),
			chips: () => {
				const paths: string[] = [];
				editor?.state.doc.descendants((node) => {
					if (node.type.name === CHIP) paths.push(String(node.attrs.path));
				});
				return paths;
			},
			before: () => (editor ? lineBefore(editor.state) : { text: "", start: 1 }),
			setText: (text) => {
				// The caret to the end, without taking the focus: the draft is put back
				// as the box is made, and that is no reason to leave where the person is.
				editor?.chain().setContent(textToDoc(text, latest.current.isFile)).setTextSelection(Number.MAX_SAFE_INTEGER).run();
			},
			replace: (from, to, what) => {
				const content = "chip" in what ? [{ type: CHIP, attrs: { path: what.chip } }, { type: "text", text: " " }] : what.text;
				editor?.chain().insertContentAt({ from, to }, content).focus().run();
			},
			insertChip: (path) => {
				editor
					?.chain()
					.insertContent([{ type: CHIP, attrs: { path } }, { type: "text", text: " " }])
					.focus()
					.run();
			},
			focus: () => {
				editor?.commands.focus();
			},
			clear: () => {
				editor?.commands.clearContent(true);
			},
		}),
		[editor],
	);

	return (
		<div className="max-h-48 w-full flex-1 overflow-y-auto">
			<EditorContent editor={editor} />
			<input ref={input} type="hidden" name="message" />
		</div>
	);
}

/** Text as the box holds it — lines, and `@path` as chips — ready to put where the caret is. */
function sliceOf(view: EditorView, text: string, isFile: (path: string) => boolean): Slice {
	const doc = view.state.schema.nodeFromJSON(textToDoc(text, isFile));
	// One line goes into the line the caret is in; more are paragraphs of their own.
	return doc.childCount === 1 ? new Slice(Fragment.from(doc.firstChild!.content), 0, 0) : new Slice(doc.content, 1, 1);
}
