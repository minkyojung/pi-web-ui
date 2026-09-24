import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, lineNumbers } from "@codemirror/view";
import { ChevronRightIcon } from "lucide-react";

import type { CommitFile, CommitRead } from "../../../commitRead.ts";
import * as colour from "../changed";
import { code } from "../codeLook";
import { commitStore } from "../serverState";
import { getConnection, subscribe } from "../store";
import { send } from "../ws";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

/**
 * What a commit changed, read in the middle column.
 *
 * A task's run ends in one commit (spec.ts), and this is where that commit
 * is read: what it says of itself at the head — whose task, how much, what
 * the run said it checked — and under it every file it changed, one after
 * another down the page. Stacked rather than one at a time behind a row of
 * names: a task's commit is a handful of files, and "what did this task do"
 * is answered by scrolling once, not by pressing each name to find out.
 *
 * Each file is the editor's own merge view over the two texts the server
 * gives (commitRead.ts), read-only, in the file's own grammar and the same
 * colours a file open to read has. The lines nothing happened to are folded
 * to "N unmodified lines" with three kept either side of a change — git's
 * own context, and GitHub's — and open again in place when pressed.
 *
 * What is in the commit and is not the task's work — the box checked in
 * tasks.md, the three documents riding in the first commit — is here too,
 * closed, at the foot: leaving it out would be a commit drawn as less than
 * it is, and leading with it would put bookkeeping before the work.
 *
 * What cannot be drawn truly says so instead: a binary file, and one too
 * large to compare whole.
 */
export default function Commit({ commit, onOpen }: { commit: string; onOpen: (path: string) => void }) {
	const answer = useSyncExternalStore(commitStore.subscribe, commitStore.get);
	// The store holds the last answer whoever asked; a tab knows its own by
	// what it asked for, since a short hash is answered with the whole one.
	const mine = answer?.asked === commit ? answer : null;
	const online = useSyncExternalStore(subscribe, getConnection) === "open";
	useEffect(() => {
		if (online) send({ type: "open_commit", commit });
	}, [online, commit]);

	if (!mine) return <div id="page" className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Opening…</div>;
	if (mine.type === "commit_gone") {
		return (
			<div id="page" data-commit={commit} className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-subtle-foreground">
				<span>There is no commit {commit.slice(0, 7)} in this repository.</span>
				<span className="text-xs">It may be on another branch, or the history may have been rewritten.</span>
			</div>
		);
	}

	const work = mine.files.filter((file) => !file.spec);
	const kept = mine.files.filter((file) => file.spec);
	return (
		<div id="page" data-commit={mine.commit} className="no-scrollbar edge-top min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-3 px-6 py-5">
				<Head read={mine} shown={work} />
				{work.map((file) => (
					<FileBlock key={file.path} file={file} onOpen={onOpen} />
				))}
				{work.length === 0 && <p className="text-sm text-subtle-foreground">Nothing outside the spec's own folder was changed.</p>}
				{mine.truncated && <p className="text-xs text-muted-foreground">This commit changed more files than are shown here.</p>}
				{kept.length > 0 && (
					<Collapsible className="flex flex-col gap-3">
						<CollapsibleTrigger id="specFiles" className="group flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground">
							<ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
							Spec files ({kept.length}) — the box checked, and the documents the first task's commit carries
						</CollapsibleTrigger>
						<CollapsibleContent className="flex flex-col gap-3">
							{kept.map((file) => (
								<FileBlock key={file.path} file={file} onOpen={onOpen} />
							))}
						</CollapsibleContent>
					</Collapsible>
				)}
			</div>
		</div>
	);
}

/** Lines added and taken out across `files`, as git counted them (commitRead.ts) — the numbers the list of results has too. */
export const counts = (files: CommitFile[]): { added: number; deleted: number } => ({
	added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
	deleted: files.reduce((sum, file) => sum + (file.deleted ?? 0), 0),
});

export function Size({ added, deleted }: { added: number; deleted: number }) {
	return (
		<span className="shrink-0 tabular-nums">
			<span style={{ color: "var(--code-string)" }}>+{added}</span> <span className="text-destructive">−{deleted}</span>
		</span>
	);
}

/** What the commit says of itself: whose task, its subject, and the sums. */
function Head({ read, shown }: { read: CommitRead; shown: CommitFile[] }) {
	const total = counts(shown);
	return (
		<header id="commitHead" className="flex flex-col gap-1.5 pb-1">
			<div className="flex min-w-0 items-center gap-2">
				{read.task && (
					<Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px] font-normal tabular-nums">
						Task {read.task}
					</Badge>
				)}
				<h1 className="min-w-0 truncate text-base font-medium">{read.title}</h1>
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
				<Badge variant="outline" className="h-5 shrink-0 px-1.5 font-mono text-[11px] font-normal" title={read.commit}>
					{read.short}
				</Badge>
				<span className="shrink-0">
					{shown.length} {shown.length === 1 ? "file" : "files"}
				</span>
				<Size {...total} />
				{/* The run's own word for how it checked its work, and said to be:
				    nothing here ran it (specResults.ts). */}
				{read.checks && (
					<span className="min-w-0 truncate" title="What the agent said it checked. The app did not run this.">
						· agent: {read.checks}
					</span>
				)}
				{read.spec && <span className="shrink-0">· {read.spec}</span>}
				<span className="shrink-0">· {new Date(read.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
			</div>
		</header>
	);
}

const WORDS: Record<CommitFile["status"], string> = { added: "New", modified: "", deleted: "Deleted", renamed: "Renamed" };

/** One file: its name and size, and under them the difference — open to begin with, or folded to the name and the size, as the page asks. */
export function FileBlock({ file, onOpen, folded = false }: { file: CommitFile; onOpen: (path: string) => void; folded?: boolean }) {
	const [open, setOpen] = useState(!folded);
	return (
		<Collapsible open={open} onOpenChange={setOpen} data-file={file.path} className="overflow-hidden rounded-md border">
			<div className="flex min-w-0 items-center gap-2 bg-muted px-2 py-1.5 text-xs">
				<CollapsibleTrigger className="group flex shrink-0 items-center text-muted-foreground hover:text-foreground" aria-label={open ? "Fold this file" : "Unfold this file"}>
					<ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
				</CollapsibleTrigger>
				{/* The name opens the file as it is now, to read — not for one that
				    is gone, which has no now. */}
				{file.status === "deleted" ? (
					<span className="min-w-0 truncate font-mono">{file.path}</span>
				) : (
					<button type="button" className="min-w-0 truncate font-mono hover:underline" title="Open this file" onClick={() => onOpen(file.path)}>
						{file.path}
					</button>
				)}
				{file.from && <span className="min-w-0 truncate text-muted-foreground">← {file.from}</span>}
				{WORDS[file.status] && <span className="shrink-0 text-muted-foreground">{WORDS[file.status]}</span>}
				<span className="ml-auto" />
				{file.added !== null && file.deleted !== null && <Size added={file.added} deleted={file.deleted} />}
			</div>
			<CollapsibleContent>
				{file.shown === "binary" ? (
					<p className="px-3 py-2 text-xs text-muted-foreground">Binary file — not shown.</p>
				) : file.shown === "large" ? (
					<p className="px-3 py-2 text-xs text-muted-foreground">Too large to compare here.</p>
				) : file.before === file.after ? (
					<p className="px-3 py-2 text-xs text-muted-foreground">Renamed, with nothing in it changed.</p>
				) : (
					<Difference file={file} />
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}

const theme = EditorView.theme({
	"&": { backgroundColor: "var(--background)", color: "var(--foreground)", fontSize: "12.5px" },
	".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.6", overflow: "auto" },
	".cm-content": { padding: "0.25rem 0" },
	".cm-gutters": { backgroundColor: "var(--background)", color: "var(--muted-foreground)", border: "none" },
	".cm-lineNumbers .cm-gutterElement": { padding: "0 0.75rem 0 0.75rem", minWidth: "3ch" },
	"&.cm-focused": { outline: "none" },
	"&.cm-editor .cm-selectionLayer .cm-selectionBackground": { background: "var(--selection)" },
	// The merge view's own colours are two classes deep and set with a
	// shorthand that resets the colour (review.ts says how that was found);
	// matched as deep here, on the same tokens a note's diff is drawn in.
	"&.cm-merge-b .cm-changedText": { background: colour.added, borderRadius: "2px" },
	"&.cm-merge-b .cm-changedLine, & .cm-inlineChangedLine": { backgroundColor: colour.addedLine },
	// The lines taken out stand where the file's own lines do: the merge view
	// pads them for the accept and reject buttons this view does not have.
	"& .cm-deletedChunk": { backgroundColor: colour.removedLine, paddingLeft: "0" },
	"& .cm-deletedChunk .cm-deletedLine": { paddingLeft: "6px" },
	"& .cm-deletedChunk .cm-deletedText": { background: colour.removed, borderRadius: "2px" },
	"& .cm-deletedChunk del, & .cm-deletedChunk .cm-deletedLine": { textDecoration: "none" },
	// Folded lines: a quiet band the width of the file, pressed to open.
	".cm-collapsedLines": {
		background: "var(--muted)",
		color: "var(--muted-foreground)",
		fontFamily: "var(--font-sans, inherit)",
		fontSize: "11px",
		padding: "2px 0.75rem",
		cursor: "pointer",
	},
	".cm-collapsedLines:hover": { color: "var(--foreground)" },
	".cm-collapsedLines:before, .cm-collapsedLines:after": { content: '""' },
});

/**
 * The difference itself: the text after, with the text before as the merge
 * view's original. Made once for the file — a commit does not change.
 *
 * Its grammar first, and the view after. The merge view draws the lines
 * taken out as the view is made and not again, so a grammar that arrives
 * later — as one does for a file open to read (Code.tsx), where that is
 * fine — colours the lines put in and leaves the ones taken out white: the
 * half of the difference that is gone reading as the half that matters
 * less. Waiting the few milliseconds a grammar takes also means the file
 * arrives coloured, rather than plain and then coloured. A name with no
 * grammar, or one that will not load, is drawn plain at once.
 */
function Difference({ file }: { file: CommitFile }) {
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let live = true;
		let view: EditorView | null = null;
		const draw = (language: Extension) => {
			if (!live || !host.current) return;
			view = new EditorView({
				parent: host.current,
				state: EditorState.create({
					doc: file.after ?? "",
					extensions: [
						EditorState.readOnly.of(true),
						EditorView.editable.of(false),
						lineNumbers(),
						language,
						syntaxHighlighting(code),
						drawSelection(),
						// "unmodified" as people say it of a diff; the merge view's own
						// word is "unchanged".
						EditorState.phrases.of({ "$ unchanged lines": "$ unmodified lines" }),
						unifiedMergeView({
							original: file.before ?? "",
							mergeControls: false,
							gutter: false,
							// The words that changed within a line, where a line changed. In
							// a file that is all new or all gone every word is, and marking
							// each one says nothing the line's own colour has not.
							highlightChanges: file.before !== null && file.after !== null,
							syntaxHighlightDeletions: true,
							// git's context, and GitHub's: three lines either side of a
							// change. Fewer than four unchanged lines are not worth a fold.
							collapseUnchanged: { margin: 3, minSize: 4 },
						}),
						EditorView.contentAttributes.of({ "aria-label": `${file.path}, what changed`, "aria-readonly": "true" }),
						theme,
					],
				}),
			});
		};
		const found = LanguageDescription.matchFilename(languages, file.path.slice(file.path.lastIndexOf("/") + 1));
		if (found) found.load().then(draw, () => draw([]));
		else draw([]);
		return () => {
			live = false;
			view?.destroy();
		};
	}, [file]);
	return <div ref={host} />;
}
