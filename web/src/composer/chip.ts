/**
 * What a file chip is, wherever it is drawn: its kind, by its name, and its
 * look — in the message box (schema.ts, plain DOM) and in a message sent
 * (FileChip.tsx, React), so the two are the same thing seen twice.
 */
import { cn } from "cn";

import { badgeVariants } from "../components/ui/badge-variants.ts";

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

/**
 * The chip's look: shadcn's outline badge, filled with the page's own ground
 * and edged in the input's line — a step down from the box and the message
 * it sits in, whose fill is the theme's secondary, and an edge that shows in
 * both themes, where the theme's border is all but gone in the dark one.
 * Less round, and sized to sit in a line of text: a word's height, the
 * file's name cut short past a width.
 */
export const CHIP_CLASS = cn(
	badgeVariants({ variant: "outline" }),
	"mx-0.5 max-w-64 justify-start rounded-md border-input bg-background px-1.5 py-px align-baseline text-[0.9em] leading-snug font-normal [&>svg]:size-3.5",
);

/** The icon inside it. */
export const CHIP_ICON_CLASS = "shrink-0 text-muted-foreground";
