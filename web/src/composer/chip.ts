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
 * A step down from the text around it — its radius, its size, its colour —
 * as a thing named in a line rather than a word of it: a word's height, the
 * file's name cut short past a width.
 */
export const CHIP_CLASS = cn(
	badgeVariants({ variant: "outline" }),
	"mx-0.5 max-w-64 justify-start rounded-sm border-input bg-background px-1.5 py-px align-baseline text-xs leading-snug font-normal text-subtle-foreground [&>svg]:size-3",
);

/** The icon inside it. */
export const CHIP_ICON_CLASS = "shrink-0 text-muted-foreground";

/** Where the message box keeps what is put in it; a picture from there is served (pictures.ts messagePictureAt). */
const GIVEN = ".octave/attachments/";

/**
 * What pressing a chip does (chipActions.ts): a picture given to the box is
 * looked at, large; anything else opens in a tab — an SVG too, read as the
 * text it is, since it is never served as a picture.
 */
export function chipAction(path: string): "picture" | "tab" {
	return fileKind(path) === "image" && path.startsWith(GIVEN) && !path.toLowerCase().endsWith(".svg") ? "picture" : "tab";
}
