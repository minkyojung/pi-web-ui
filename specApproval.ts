/**
 * Where a spec is: which of its documents the person has approved, and which
 * one is waiting for them — docs/spec-mode/approval-gates.md.
 *
 * A spec is three documents written in turn, each on the one before it, and
 * the next is written only once the person has approved the last. Kiro keeps
 * that order by telling its model to ask and to wait for a yes; the model is
 * then the one who decides what a yes was. Here the person approves with a
 * command, and what they approved is written down beside the documents, in
 * `approvals.json`: for each document, the fingerprint of it and of every
 * document before it, as they were when it was approved.
 *
 * So there is nothing to keep in step. A document is approved while it and
 * the ones before it are still what was approved; change one — the person in
 * an editor, the agent asked to — and it and everything after it are waiting
 * again, with no code to undo an approval. Going back to the requirements is
 * then the way forward was: approve them again, and the design is the one
 * waiting. And put back as it was, a document is approved again, since what
 * was approved is the text. The one loosening is the boxes of the tasks,
 * which say how far the work has got rather than what was agreed — see
 * fingerprint below, and docs/spec-mode/task-runs.md.
 *
 * In the spec's folder, so it goes into the repository with the documents:
 * a pull request shows what was approved, and a session that starts later —
 * a task run in one of its own — finds it where the documents are. It is not
 * a spec document (documentKinds.ts's isSpec takes `.md` only), so it opens
 * in no tab.
 *
 * Nothing of Octave's in it, like spec.ts, which runs in pi's terminal too.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./atomic.ts";
import { SPECS_DIR } from "./documentKinds.ts";
import { withDone } from "./specTasks.ts";

/** A spec's documents, in the order they are written and approved. */
export const SPEC_DOCS = ["requirements.md", "design.md", "tasks.md"] as const;
export type SpecDoc = (typeof SPEC_DOCS)[number];

/** The record of what was approved, in the spec's folder beside the documents. */
export const APPROVALS = "approvals.json";

export interface SpecState {
	/** How many of SPEC_DOCS, from the first, are approved as they are now. */
	approved: number;
	/** The document written and waiting for the person to approve it, or null. */
	waiting: SpecDoc | null;
}

/**
 * The file's fingerprint, or null when there is no file to read.
 *
 * The tasks are fingerprinted with their boxes emptied. What the person
 * approved is the plan, and a task checked off is how far it has got, not a
 * change to it: a list approved and then worked through is the same list, and
 * without this every finished task would ask to be approved again. The text
 * around the boxes is held to as closely as the other two documents are.
 */
function fingerprint(doc: SpecDoc, file: string): string | null {
	try {
		const read = readFileSync(file);
		// Bytes for the documents that are only text, so what was approved before
		// this went in reads the same; the tasks are read as the text they are.
		return createHash("sha256")
			.update(doc === "tasks.md" ? withDone(read.toString("utf8"), new Set()) : read)
			.digest("hex");
	} catch {
		return null;
	}
}

/** The record as written, or an empty one: none yet, or none that can be read. */
function readApprovals(dir: string): Record<string, unknown> {
	try {
		const record: unknown = JSON.parse(readFileSync(join(dir, APPROVALS), "utf8"));
		return record !== null && typeof record === "object" && !Array.isArray(record) ? (record as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** The state, and the fingerprints it was read from — the approved documents' and the waiting one's. */
function look(dir: string): SpecState & { prints: string[] } {
	const approvals = readApprovals(dir);
	const prints: string[] = [];
	for (const doc of SPEC_DOCS) {
		const print = fingerprint(doc, join(dir, doc));
		if (print === null) return { approved: prints.length, waiting: null, prints };
		prints.push(print);
		const record = approvals[doc];
		// A record that is not the one written here reads as no approval: a
		// document is let through by what is known, never by what is not.
		const same = Array.isArray(record) && record.length === prints.length && record.every((given, i) => given === prints[i]);
		if (!same) return { approved: prints.length - 1, waiting: doc, prints };
	}
	return { approved: SPEC_DOCS.length, waiting: null, prints };
}

/** Where the spec called `name` is, in the folder `cwd`. */
export function specState(cwd: string, name: string): SpecState {
	const { approved, waiting } = look(join(cwd, SPECS_DIR, name));
	return { approved, waiting };
}

/**
 * Approve the document the spec is waiting on, as it is now: the one approved,
 * or null when none was waiting.
 */
export function approve(cwd: string, name: string): SpecDoc | null {
	const dir = join(cwd, SPECS_DIR, name);
	// The same reading decides what is waiting and what is written down for it.
	const { waiting, prints } = look(dir);
	if (!waiting) return null;
	writeAtomic(join(dir, APPROVALS), `${JSON.stringify({ ...readApprovals(dir), [waiting]: prints }, null, 2)}\n`);
	return waiting;
}
