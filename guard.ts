/**
 * What pi is told about the vault, and what it is kept out of.
 *
 * Three things a note app on the pi harness needs from pi's own extension
 * points, none of which the tool ladder gives:
 *
 * - After pi's own system prompt, what this folder is — a workspace of a
 *   repository — how to ask, that `.pi/` is the app's and not to be touched,
 *   and how to point at a file. pi's prompt is left as pi writes it: Octave
 *   is a coding agent now (docs/spec-mode), and that prompt is a coding
 *   agent's, with the tools in use listed and their guidelines beside them —
 *   which a prompt in its place left out. There was one in its place while
 *   this was an app for notes (OCTAVE_PROMPT, kept below and not used). A
 *   SYSTEM.md the person gave pi still takes the place of pi's.
 * - A hard stop on `.pi/`. The history there is the record of who wrote
 *   what; a tool call that rewrites or removes it corrupts that silently, so
 *   `edit`, `write` and `bash` are blocked before they run, whatever the
 *   mode. The instruction above is the soft version; this is the one that
 *   holds when the instruction is forgotten.
 * There used to be a fourth: a hard stop on writing a note by hand, so that
 * every note went through the app's own pair and was recorded as the agent's.
 * The record is given up (docs/spec-mode), and the stop outlived it — it was
 * what kept a task from touching a README. A file is a file now, as it is on
 * every other harness; what a change of the person's is protected by is the
 * editor, which already holds unsaved typing against a write from elsewhere
 * and asks (noteSync.ts), and what a change of the agent's is undone by is
 * git, a task being a commit.
 * - A hard stop on writing git's own files by hand. A branch renamed by
 *   writing `.git/HEAD` and a ref leaves the old branch standing and no
 *   record in git's logs, and the model reaches for that when it has no
 *   shell; a git command is the only way in. Codex keeps `.git` read-only
 *   inside a folder it may write for the same reason. Only edit and write:
 *   the shell's `git` is how git is meant to be changed.
 * - The tab in front — a note, a file, or a page of the app's own, said as
 *   its address and never its contents — and the words chosen in it, given as
 *   a hidden message of their own beside the person's rather than as text in it. As
 *   their text it was replayed with a stale path when a question was asked
 *   again or a branch navigated; a message of its own is left behind with the
 *   branch, and says it was as of that message. It was a line of the turn's
 *   system prompt for a while, which kept it out of the session — but that
 *   prompt comes before the whole conversation, so every note opened or
 *   words chosen made the provider's cache of the conversation useless.
 *
 * Inline, like wall.ts and noteEdit.ts, and bound per session with them.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, sep } from "node:path";
import { APP_DIR_NAME, isDocument, isSpec, SPECS_DIR } from "./documentKinds.ts";

/** What the app keeps beside the notes. Nothing of pi's may go there. */

/**
 * Who the agent was while this was an app for notes, in place of pi's
 * coding-agent opening. Not used since 2026-09-21 — pi's own prompt stands,
 * and what this said of asking is in WORKSPACE_PROMPT — and kept until the
 * direction is settled (docs/spec-mode 5절).
 */
export const OCTAVE_PROMPT = `You are at the table with a person and their notes. You are not their programmer: you are someone they think with, and someone who gets things done for them.

Before acting, work out what this message wants:
- To think something through — think with them. Ask what they mean, say where you disagree, bring up what they have not considered. Do not settle it for them, and do not write it into a note unless they ask.
- To have something done — do it, making the ordinary choices yourself, then say in a line or two what you did.
- If you cannot tell which of these they want, or doing it would mean deciding something only they can, ask one short question with ask_user — not in your reply, where nothing waits for the answer.

The notes are their writing. Read them freely; change only what was asked, in their voice. A change you think would help but was not asked for is a suggestion to make, not an edit.

Talk as a person across the table would: plainly, and briefly unless they ask for more.`;

/** What is said after pi's own system prompt: where the agent is, and the few rules that are this app's. */
export const WORKSPACE_PROMPT = [
	"You are working in a workspace of a git repository: a git worktree — a folder and a branch of its own — made for one piece of work. Read the code before you change it, and follow what the repository already does — its structure, its naming, its tests.",
	// What Conductor tells the agents it runs in a worktree, which holds here
	// for the same reasons: the clone beside it is the person's own, the app
	// names the branch, the stash is every worktree's at once, and one
	// workspace is one piece of work.
	"Stay in this folder: the clone it was made from, and the repository's other worktrees, are not yours to change or to run commands in. Do not rename this branch or check out another — the app names the branch after the work — and do not use git stash, whose stack every worktree of the repository shares. Do not commit or push unless you are asked to.",
	"Write the last message of a turn so that it can be read alone: what you did, what you found, what they should look at — what you said on the way is folded away once the turn ends. What has to outlast this conversation goes in a document or a file, not in the chat: the next session here will not have read it.",
	"If the person asks for something unrelated to what this workspace was made for, do it if it is small, and otherwise say that a new spec, with + beside the repository, would give it a workspace and a branch of its own.",
	"If you cannot tell what the person wants, or doing it would mean deciding something only they can, ask one short question with ask_user — not in your reply, where nothing waits for the answer. A change you think would help but was not asked for is a suggestion to make, not an edit.",
	"Markdown files (.md) are read and changed with read, edit and write like any other file. One may open with a `---` block of properties; change those with note_properties, never by editing that block as text: it is YAML, and a quote or an indent out of place there takes the file out of the app's index without saying so.",
	"A .pdf in the folder is read with read as well: it comes back as its text, page by page, and a long one is continued with offset like any file. grep and bash see only its bytes.",
	`bash cannot write anything under ${APP_DIR_NAME}/: the operating system refuses it. Everything else in the folder it may write.`,
	`The folder ${APP_DIR_NAME}/ belongs to the app — it holds the app's own records — and must not be read as the repository's files, written, or removed; tools that try are refused.`,
	"When you refer to a file, use its path relative to this folder.",
].join(" ");

/** Whether a path, as a tool would take it, lies under the app's folder. */
export function underAppDir(root: string, given: string): boolean {
	const rel = isAbsolute(given) ? relative(root, given) : given;
	const first = rel.split(/[\\/]/)[0];
	return first === APP_DIR_NAME;
}

/**
 * Whether a path, as a tool would take it, is git's own: `.git` itself — a
 * worktree's is a file naming the repository — or anything under one, here,
 * in the repository a worktree belongs to, or in a repository nested inside.
 */
export const inGit = (given: string): boolean => given.split(/[\\/]/).includes(".git");

/**
 * Whether a shell command reaches into the app's folder. A pattern, not a
 * parse: `.pi/` or a bare `.pi` as a word is not something a note needs, so
 * any mention is refused rather than only the ones a parser would catch.
 */
export function mentionsAppDir(command: string): boolean {
	return new RegExp(`(^|[\\s"'\`=:(])\\${APP_DIR_NAME}(?=[/\\s"'\`)]|$)`).test(command);
}

/**
 * The tab in front — a file's path, or the address of a page of the app's own
 * (web/src/pages.ts) — and the words chosen in it, if any.
 */
export type Front = { path: string; chosen: string | null; page?: string };

/**
 * What a page of the app's own shows, said as where the same is found in the
 * folder and in git: the address, and nothing of what the page holds, so pi
 * reads it for itself when it matters. Read as pages.ts reads the address;
 * anything else under the scheme — what is new in this version — is nothing
 * the conversation is about, and null.
 */
function lookingAtPage(address: string): string | null {
	const task = /^octave:\/\/task\/([^/]+)\/(\d+(?:\.\d+)?)$/.exec(address);
	if (task) {
		const [, spec, number] = task;
		return `When they sent this message, the person had the page of task ${number} of the spec in ${SPECS_DIR}${spec}/ open: what its run said and the files it changed, or its commit once accepted. The task itself is in ${SPECS_DIR}${spec}/tasks.md.`;
	}
	const commit = /^octave:\/\/commit\/([0-9a-f]{7,40})$/.exec(address);
	if (commit) return `When they sent this message, the person had the page of commit ${commit[1]} open: its message and the files it changed (git show ${commit[1]}).`;
	if (address === "octave://changes") return "When they sent this message, the person had the page of the changes not yet committed open: each file changed since the last commit, before and after (git diff HEAD).";
	return null;
}

/**
 * What the person was looking at, said beside their message. Kept in the
 * conversation with it, so it is said as of that message rather than as now.
 * Null where the tab in front is nothing to say.
 */
export function looking(note: Front): string | null {
	// A page of the app's own has no words chosen in it that are sent (chosen.ts).
	if (note.path.startsWith("octave://")) return lookingAtPage(note.path);
	// A PDF in front is said as one: pi reads it with read, not as a note, and
	// the page is where to read around the chosen words — read names each page.
	const document = isDocument(note.path);
	// A spec is markdown in the editor like a note, and said as what it is: told
	// it was a note, pi reaches for note_edit, which refuses it.
	//
	// And a file of the repository, which the window shows and does not write:
	// said as a file being read, so a question about it is answered about the
	// code and not about a note nobody has.
	const line = document
		? `When they sent this message, the person had this document open beside the conversation: ${note.path} (read it with read; it comes back page by page)`
		: isSpec(note.path)
			? `When they sent this message, the person had this spec open in their editor: ${note.path} (a spec is not a note: change it with edit or write, not note_edit)`
			: note.path.endsWith(".md")
				? `When they sent this message, the person had this note open in their editor: ${note.path}`
				: `When they sent this message, the person was reading this file of the repository: ${note.path}`;
	if (!note.chosen) return line;
	const where = document && note.page ? ` on page ${note.page.replace("-", " to ")}` : "";
	// Quoted, and said to be a part of the note rather than a thing to answer
	// about on its own: the question is the message, this is what it points at.
	return `${line}\nThey have chosen these words in it${where}, which is what their message is about unless they say otherwise:\n${note.chosen
		.split("\n")
		.map((words) => `> ${words}`)
		.join("\n")}`;
}

export const guard = (root: string, front: () => Front | null) => (pi: ExtensionAPI) => {
	pi.on("tool_call", async (event) => {
		const input = event.input as { path?: unknown; command?: unknown };
		if ((event.toolName === "edit" || event.toolName === "write") && typeof input.path === "string") {
			if (underAppDir(root, input.path)) {
				return { block: true, reason: `${input.path} is under ${APP_DIR_NAME}/, which belongs to the app and is not to be changed.` };
			}
			if (inGit(input.path)) {
				return { block: true, reason: `${input.path} is git's own file. Change the repository with a git command, not by writing its files.` };
			}
		}
		if (event.toolName === "bash" && typeof input.command === "string" && mentionsAppDir(input.command)) {
			return { block: true, reason: `Commands must not touch ${APP_DIR_NAME}/; it belongs to the app that shows these notes.` };
		}
		return undefined;
	});

	// A message beside the person's rather than a line of the system prompt:
	// the system prompt comes before the whole conversation, so changing it
	// with every note opened would throw away the provider's cache of all of it.
	pi.on("before_agent_start", async () => {
		const note = front();
		const said = note && looking(note);
		if (!said) return undefined;
		return { message: { customType: "open-note", content: said, display: false, details: { front: note.path } } };
	});
};
