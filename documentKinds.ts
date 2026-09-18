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
