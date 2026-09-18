/**
 * A tab that is not a note.
 *
 * The row of tabs holds addresses, and a note's address is its path. A page
 * of the app's own — what is new in this version — takes an address of the
 * same shape under a scheme no file has, so the row, the way back, the saved
 * tabs and the hash need no second kind of thing; what looks at the address
 * as a file asks pageOf first. VS Code's untitled: is the same move.
 */
const WHATS_NEW = "octave://whats-new/";
export const WELCOME = "octave://welcome";

export type Page = { kind: "whats-new"; version: string; title: string } | { kind: "welcome"; title: string };

export const whatsNewPath = (version: string): string => `${WHATS_NEW}${version}`;

export function pageOf(path: string | null): Page | null {
	if (path === WELCOME) return { kind: "welcome", title: "Welcome" };
	if (!path?.startsWith(WHATS_NEW)) return null;
	const version = path.slice(WHATS_NEW.length);
	return /^\d+\.\d+\.\d+$/.test(version) ? { kind: "whats-new", version, title: `What's new in ${version}` } : null;
}

export const isPage = (path: string | null): boolean => pageOf(path) !== null;

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
