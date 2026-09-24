/**
 * A tab that is not a note.
 *
 * The row of tabs holds addresses, and a note's address is its path. A page
 * of the app's own — what is new in this version — takes an address of the
 * same shape under a scheme no file has, so the row, the way back, the saved
 * tabs and the hash need no second kind of thing; what looks at the address
 * as a file asks pageOf first. VS Code's untitled: is the same move.
 */
import { isDocument } from "../../documentKinds.ts";
import { forFolder } from "./workspace.ts";

const WHATS_NEW = "octave://whats-new/";

/** A commit, to read what it changed: `octave://commit/<hash>`, the hash whole or short. */
const COMMIT = "octave://commit/";

/** A task, to look at what its run said and changed: `octave://task/<spec>/<number>` — the same address before and after it is accepted. */
const TASK = "octave://task/";

/** The files changed and not committed, each before and after: one page for all of them, so there is one tab however many are looked at. */
const CHANGES = "octave://changes";

/** The scheme no file has, which the app's own pages take their address under. */
const SCHEME = "octave://";

/**
 * A page of the app's own, or a file in the folder that is not a note — a
 * document (a PDF), or any other file of the repository, read as text. None
 * of them is a note: the middle column belongs to a viewer, and the editor,
 * the title, the properties and the log are not in it.
 */
export type Page =
	| { kind: "whats-new"; version: string; title: string }
	| { kind: "document"; path: string; title: string }
	| { kind: "code"; path: string; title: string }
	/** What a commit changed, file by file (Commit.tsx). The title is the hash as people say it; the tab learns the rest. */
	| { kind: "commit"; commit: string; title: string }
	/** What a task's run said and changed (Task.tsx), in review or accepted. The title is the number; the tab learns the line. */
	| { kind: "task"; spec: string; task: string; title: string }
	/** What is changed and not committed, file by file (Changes.tsx). */
	| { kind: "changes"; title: string };

export const whatsNewPath = (version: string): string => `${WHATS_NEW}${version}`;

/** The address of a commit's page. */
export const commitPath = (commit: string): string => `${COMMIT}${commit}`;

/** The address of a task's page. */
export const taskPath = (spec: string, task: string): string => `${TASK}${spec}/${task}`;

/** The address of the Changes page. */
export const changesPath = CHANGES;

/** A tab says a file by its name whole, extension and all — that is how it says what it is. */
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function pageOf(path: string | null): Page | null {
	if (!path) return null;
	if (isDocument(path)) return { kind: "document", path, title: nameOf(path) };
	if (path.startsWith(COMMIT)) {
		// A hash and nothing else, as the server will have it (commitRead.ts):
		// an address is typed and pasted, and what is not a commit's name is
		// no page rather than a question put to git.
		const commit = path.slice(COMMIT.length);
		return /^[0-9a-f]{7,40}$/.test(commit) ? { kind: "commit", commit, title: commit.slice(0, 7) } : null;
	}
	if (path.startsWith(TASK)) {
		// A spec's folder name and a task's number, as the plan has them
		// (specTasks.ts): anything else is no page.
		const found = /^([^/]+)\/(\d+(?:\.\d+)?)$/.exec(path.slice(TASK.length));
		return found ? { kind: "task", spec: found[1]!, task: found[2]!, title: `Task ${found[2]}` } : null;
	}
	if (path === CHANGES) return { kind: "changes", title: "Changes" };
	if (path.startsWith(SCHEME)) {
		if (!path.startsWith(WHATS_NEW)) return null;
		const version = path.slice(WHATS_NEW.length);
		return /^\d+\.\d+\.\d+$/.test(version) ? { kind: "whats-new", version, title: `What's new in ${version}` } : null;
	}
	// Everything else in the folder. Markdown is the editor's — a note, or a
	// spec, which is markdown the notes' lists do not hold — and the rest is
	// read: a repository's code, its config, its workflows (repoFiles.ts).
	return path.endsWith(".md") ? null : { kind: "code", path, title: nameOf(path) };
}

export const isPage = (path: string | null): boolean => pageOf(path) !== null;

/**
 * A file of the repository — one this window reads and does not write. The one
 * place that question is answered, so the tab that draws it, the line that
 * says where it is and the menu beside that line cannot disagree about it.
 */
export const isCode = (path: string | null): boolean => pageOf(path)?.kind === "code";

/** Where the server gives a file in the folder out, by its path (the /vault route). */
export const vaultUrl = (path: string): string => forFolder(`/vault/${path.split("/").map(encodeURIComponent).join("/")}`);

/**
 * A changelog section as blocks to draw: the only marks it uses are a
 * heading, a bullet and `code`. Drawn from these rather than parsed as
 * markdown, since the file is ours and the renderer is then nothing.
 */
export type Block = { kind: "heading"; text: string } | { kind: "list"; items: string[] } | { kind: "paragraph"; text: string };

export function blocksOf(notes: string): Block[] {
	const blocks: Block[] = [];
	for (const line of notes.split("\n")) {
		const last = blocks[blocks.length - 1];
		if (line.startsWith("### ")) blocks.push({ kind: "heading", text: line.slice(4).trim() });
		else if (line.startsWith("- ")) {
			if (last?.kind === "list") last.items.push(line.slice(2).trim());
			else blocks.push({ kind: "list", items: [line.slice(2).trim()] });
		} else if (line.trim()) {
			// A paragraph runs on over a wrapped line; a blank line ended it.
			if (last?.kind === "paragraph" && last.text) last.text += ` ${line.trim()}`;
			else if (last?.kind === "paragraph") last.text = line.trim();
			else blocks.push({ kind: "paragraph", text: line.trim() });
		} else if (last?.kind === "paragraph" && last.text) blocks.push({ kind: "paragraph", text: "" });
	}
	return blocks.filter((b) => b.kind !== "paragraph" || b.text);
}

/** `code` set apart, and nothing else read into the text. */
export const spansOf = (text: string): { code: boolean; text: string }[] =>
	text.split(/(`[^`]*`)/).filter(Boolean).map((part) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? { code: true, text: part.slice(1, -1) } : { code: false, text: part }));
