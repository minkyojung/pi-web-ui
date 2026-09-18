/**
 * Files pi reads as text that are not text.
 *
 * pi's `read` knows text files and images, and nothing else: a PDF read with
 * it is its bytes taken for UTF-8, fifty kilobytes of them, and the model
 * reads that as best it can. The person, though, keeps PDFs in the folder as
 * they keep notes — a paper beside the note about it — and points at one the
 * way they point at a note, by its path. So a PDF stays what it is, on disk
 * and in the message, and only where pi reads it is it turned into words.
 *
 * Done where pi documents it: a `tool_result` handler, which may replace
 * what a tool returned. When `read` was asked for a file of a kind listed
 * below, what it returned is set aside and the file's text put in its place,
 * page by page, cut and continued exactly as pi's own `read` cuts a long
 * file — the same limits, the same sentence saying which offset to ask for
 * next — since that is the shape the model already knows how to follow.
 *
 * Only reading changes. `grep` does not see inside a PDF, and the shell reads
 * the bytes as it always did; pi is told as much in its prompt.
 *
 * One table, keyed by extension. The row is a function from bytes to pages,
 * and a second kind of file is a second row.
 *
 * Inline, like guard.ts and wall.ts, and bound per session with them.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, resolve } from "node:path";
import { DEFAULT_MAX_BYTES, type ExtensionAPI, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";

/** A file's text, one string per page. A page with no text layer is an empty string. */
export type Pages = (bytes: Buffer) => Promise<string[]>;

/** The kinds of file read as text, by extension, lower case. */
export const readers: Record<string, Pages> = {
	".pdf": async (bytes) => {
		const { extractText } = await import("unpdf");
		const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
		return text;
	},
};

/** Whether `read` on this path is one of ours. */
export const isDocument = (path: string): boolean => extname(path).toLowerCase() in readers;

/** The path as pi's `read` takes it: a leading `@` dropped, `~` the home folder, the rest against the folder. */
export function resolvePath(given: string, cwd: string): string {
	let path = given.startsWith("@") ? given.slice(1) : given;
	if (path === "~" || path.startsWith("~/")) path = homedir() + path.slice(1);
	return isAbsolute(path) ? path : resolve(cwd, path);
}

/**
 * The pages as one text, each under a line naming it, so the model can say
 * "page 3" back and a person can find it. A page with no text says so, since
 * a blank where a page should be reads as nothing there rather than as a
 * scan the reader could not see into.
 */
export function pagesText(pages: string[]): string {
	return pages.map((text, i) => `--- page ${i + 1} of ${pages.length} ---\n${text.trim() || "[no text on this page: it may be a scanned image]"}`).join("\n\n");
}

/**
 * The part of the text `read` was asked for — `offset` and `limit` are 1-based
 * lines, as pi's `read` takes them — cut where pi would cut it and followed by
 * pi's own sentence about how to go on. A copy of the tail of pi's read tool,
 * which is not exported; the model has learned that sentence, so it is kept
 * to the letter.
 */
export function portion(text: string, offset?: number, limit?: number): string {
	const lines = text.split("\n");
	const start = offset ? Math.max(0, offset - 1) : 0;
	if (start >= lines.length) throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`);
	const end = limit !== undefined ? Math.min(start + limit, lines.length) : lines.length;
	const cut = truncateHead(lines.slice(start, end).join("\n"));
	const first = start + 1;
	if (cut.firstLineExceedsLimit) return `[Line ${first} is ${formatSize(Buffer.byteLength(lines[start]!, "utf-8"))}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit.]`;
	if (cut.truncated) {
		const last = first + cut.outputLines - 1;
		const by = cut.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
		return `${cut.content}\n\n[Showing lines ${first}-${last} of ${lines.length}${by}. Use offset=${last + 1} to continue.]`;
	}
	if (end < lines.length) return `${cut.content}\n\n[Showing lines ${first}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`;
	return cut.content;
}

/**
 * A file's pages, read once per version of the file: a model walking a long
 * PDF asks for it a screen at a time, and the pages do not change between
 * asks. A handful is kept; the folder may hold a thousand.
 */
export function createDocuments(keep = 4) {
	const cache = new Map<string, { mtime: number; pages: string[] }>();
	return async (path: string): Promise<string[]> => {
		const mtime = statSync(path).mtimeMs;
		const had = cache.get(path);
		if (had && had.mtime === mtime) return had.pages;
		const pages = await readers[extname(path).toLowerCase()]!(readFileSync(path));
		cache.delete(path);
		cache.set(path, { mtime, pages });
		if (cache.size > keep) cache.delete(cache.keys().next().value!);
		return pages;
	};
}

export const documents = (root: string) => (pi: ExtensionAPI) => {
	const pagesOf = createDocuments();
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "read") return;
		const input = event.input as { path?: unknown; offset?: unknown; limit?: unknown };
		if (typeof input.path !== "string" || !isDocument(input.path)) return;
		const path = resolvePath(input.path, root);
		try {
			const pages = await pagesOf(path);
			const offset = typeof input.offset === "number" ? input.offset : undefined;
			const limit = typeof input.limit === "number" ? input.limit : undefined;
			return { content: [{ type: "text", text: portion(pagesText(pages), offset, limit) }], isError: false };
		} catch (err) {
			return { content: [{ type: "text", text: `Could not read ${input.path} as a document: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
		}
	});
};
