/**
 * Which files are documents, said once for both ends.
 *
 * A document is a file that is not a note but is kept like one: pi reads it
 * as text (documents.ts), the folder lists it, the window opens it in a tab.
 * Every one of those asks the same question of a path, and the browser asks
 * it too — of the address, before the server has said anything — so the
 * answer lives here, with nothing imported, where both can reach it. A second
 * kind of document is a second row here and a reader for it in documents.ts;
 * a test holds the two tables to the same keys.
 *
 * And the spec, the one kind that is markdown and still not a note: what the
 * agent writes under `.octave/specs/` (docs/spec-mode). It opens in the editor
 * and is changed there, but keeps no record of who wrote it and is in none
 * of the notes' lists — vault.ts's specAt is the door to one.
 *
 * Shared at the repo root like naming.ts.
 */
export const DOCUMENT_TYPES: Record<string, string> = {
	".pdf": "application/pdf",
};

/** The file's type by its name, or null for a file that is not a document. */
export function documentType(path: string): string | null {
	const dot = path.lastIndexOf(".");
	return dot === -1 || dot < path.lastIndexOf("/") ? null : (DOCUMENT_TYPES[path.slice(dot).toLowerCase()] ?? null);
}

export const isDocument = (path: string): boolean => documentType(path) !== null;

/** The folder of Octave's own that goes into the repository with the work — not `.pi/`, which is the app's and stays out. */
export const OCTAVE_DIR = ".octave";

/** That other folder: the app's own, in the person's folder but not of it, and never in their commits. */
export const APP_DIR_NAME = ".pi";

/** Where the specs are, from the top of the folder. */
export const SPECS_DIR = `${OCTAVE_DIR}/specs/`;

/**
 * A spec's documents, in the order they are written and approved. The record
 * of which of them a person has approved is specApproval.ts's, which reads
 * the disk; the order and the names are read by the window too, so they are
 * here with the rest of what both ends must agree on.
 */
export const SPEC_DOCS = ["requirements.md", "design.md", "tasks.md"] as const;
/** The two that wait for the person's approval before the next is written. The tasks are not approved: they are run, and running one is the person's word on it. */
export const APPROVED_DOCS = ["requirements.md", "design.md"] as const;
export type SpecDoc = (typeof SPEC_DOCS)[number];

/** That record's name, in the spec's folder beside the documents. */
export const APPROVALS = "approvals.json";

/**
 * What a path under SPECS_DIR is made of, or null for anything that is not
 * under it — and null too for a hidden file below, or a name that is empty.
 * The one reading the three questions below are asked of.
 */
function specParts(path: string): string[] | null {
	if (!path.startsWith(SPECS_DIR)) return null;
	const parts = path.slice(SPECS_DIR.length).split("/");
	return parts.some((part) => part === "" || part.startsWith(".")) ? null : parts;
}

/**
 * Whether a path from the folder, as the vault names it, is a spec: markdown
 * under SPECS_DIR, spelled `.md` as a note must be, and no hidden file below.
 * Read off the name, as documentType is; what the disk says is specAt's.
 */
export const isSpec = (path: string): boolean => specParts(path) !== null && path.endsWith(".md");

/** Whether a path is a spec's tasks document: the one with boxes, which the window can read as a plan (taskTree.ts) and which runs are read off. */
export const isTasks = (path: string): boolean => isSpec(path) && path.endsWith("/tasks.md");

/** The spec a path belongs to — the folder under SPECS_DIR it is in — or null. */
export function specNameOf(path: string): string | null {
	const parts = specParts(path);
	return parts && parts.length > 1 ? parts[0] : null;
}

/**
 * Whether a path is a spec's approvals record: the file itself, in the spec's
 * own folder. It opens in no tab — it is not markdown — but a change to it
 * changes what is waiting for the person, so it is watched like the documents.
 */
export const isSpecRecord = (path: string): boolean => {
	const parts = specParts(path);
	return parts !== null && parts.length === 2 && parts[1] === APPROVALS;
};
