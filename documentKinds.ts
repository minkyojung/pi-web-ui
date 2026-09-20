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
 * Whether a path from the folder, as the vault names it, is a spec: markdown
 * under SPECS_DIR, spelled `.md` as a note must be, and no hidden file below.
 * Read off the name, as documentType is; what the disk says is specAt's.
 */
export const isSpec = (path: string): boolean =>
	path.startsWith(SPECS_DIR) && path.endsWith(".md") && !path.slice(SPECS_DIR.length).split("/").some((part) => part === "" || part.startsWith("."));
