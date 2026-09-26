/**
 * What a file chip is, wherever it is drawn: its kind, by its name, and its
 * look — in the message box (schema.ts, plain DOM) and in a message sent
 * (FileChip.tsx, React), so the two are the same thing seen twice.
 */
export type FileKind = "image" | "pdf" | "note" | "code" | "file";

export function fileKind(path: string): FileKind {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
	if (/^(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(ext)) return "image";
	if (ext === "pdf") return "pdf";
	if (ext === "md") return "note";
	return ext ? "code" : "file";
}

export const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** The chip's box: a word's height, the file's name cut short past a width. */
export const CHIP_CLASS = "mx-0.5 inline-flex max-w-64 items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-px align-baseline text-[0.9em] leading-snug";

/** The icon inside it. */
export const CHIP_ICON_CLASS = "size-3.5 shrink-0 text-muted-foreground";
