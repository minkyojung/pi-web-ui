/**
 * An image a note refers to, found on the disk the way Obsidian finds it.
 *
 * A note says `![[a.png]]` or `![a](images/a.png)`, and either can name the
 * file from three places: as the folder names it, as the note's own folder
 * names it, or by its name alone, wherever it is — which is what Obsidian
 * means by `![[a.png]]`, and why a note dragged into a subfolder keeps its
 * pictures. Tried in that order; by name alone, the note's own folder first,
 * then the shallowest, so two `a.png`s resolve the way a person would guess.
 *
 * Only images, only inside the folder (fileAt), never under a dot-folder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

import { fileAt } from "./vault.ts";

export const IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".bmp": "image/bmp",
};

const SKIP = new Set(["node_modules", "dist", "dist-server", "release", "build", "out"]);

/** The file's type by its name, or null for a file that is not an image. */
export function imageType(path: string): string | null {
	const dot = path.lastIndexOf(".");
	return dot === -1 ? null : (IMAGE_TYPES[path.slice(dot).toLowerCase()] ?? null);
}

export function attachmentAt(root: string, given: string, from = ""): { path: string; full: string; type: string } | null {
	const type = imageType(given);
	if (!type) return null;
	const at = (rel: string) => {
		const file = fileAt(root, rel);
		return file && imageType(file.path) && isFile(file.full) ? { ...file, type } : null;
	};
	// As the folder names it, then as the note's folder names it.
	const direct = at(given) ?? (from ? at(posix.join(posix.dirname(from), given)) : null);
	if (direct) return direct;
	// By name alone: `a.png` anywhere. Not `images/a.png` — a path is a path.
	if (given.includes("/")) return null;
	const name = given.toLowerCase();
	const found = findByName(root, name);
	if (found.length === 0) return null;
	const near = from ? posix.dirname(from) : "";
	found.sort((a, b) => (a.dir === near ? -1 : b.dir === near ? 1 : a.depth - b.depth || a.path.localeCompare(b.path)));
	return at(found[0].path);
}

function isFile(full: string): boolean {
	try {
		return statSync(full).isFile();
	} catch {
		return false;
	}
}

/** Every file called `name` (case-insensitively) under `root`, outside dot-folders. */
function findByName(root: string, name: string): { path: string; dir: string; depth: number }[] {
	const out: { path: string; dir: string; depth: number }[] = [];
	const walk = (dir: string, rel: string, depth: number) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
			const path = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(dir, entry.name), path, depth + 1);
			else if (entry.isFile() && entry.name.toLowerCase() === name) out.push({ path, dir: rel, depth });
		}
	};
	walk(root, "", 0);
	return out;
}

/**
 * Where a picture pasted into a note is kept: the folder Obsidian was told
 * to use, if the vault is one and it was told (`.obsidian/app.json`,
 * `attachmentFolderPath` — a folder, `./` for beside the note, or `/` for the
 * root), else `attachments/`. Obsidian's own default is the root, which a
 * folder of notes fills with screenshots; a folder of their own is what most
 * vaults are set to anyway.
 */
export function attachmentFolder(root: string, from: string): string {
	let told: string | undefined;
	try {
		told = JSON.parse(readFileSync(join(root, ".obsidian", "app.json"), "utf8")).attachmentFolderPath;
	} catch {
		// Not an Obsidian vault, or not told: the default below.
	}
	if (typeof told !== "string" || told === "") return "attachments";
	if (told === "/") return "";
	if (told === "./") return posix.dirname(from) === "." ? "" : posix.dirname(from);
	if (told.startsWith("./")) return posix.normalize(posix.join(posix.dirname(from), told.slice(2)));
	return told.replace(/^\/|\/$/g, "");
}

/**
 * A pasted picture, written where it goes, under a name of its own: the
 * name it came with, or — for the nameless kind a clipboard gives — one
 * from the moment, as Obsidian names them. A name already taken gets a
 * number. Returns the path as the folder names it, for `![[name]]`.
 */
export function savePicture(root: string, from: string, given: string, bytes: Uint8Array, now = new Date()): { path: string; name: string } | null {
	if (!imageType(given)) return null;
	const folder = attachmentFolder(root, from);
	const dir = fileAt(root, folder || ".") ?? (folder ? { path: folder, full: join(root, folder) } : { path: "", full: root });
	if (!dir || dir.path.split("/").some((part) => part.startsWith("."))) return null;
	// The name as given, extension and all: a person's file keeps its spelling.
	const ext = given.slice(given.lastIndexOf("."));
	const stem = /^(image|screenshot|pasted image)?$/i.test(given.slice(0, -ext.length).trim())
		? `Pasted image ${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`
		: given.slice(0, -ext.length).trim();
	mkdirSync(dir.full, { recursive: true });
	let name = `${stem}${ext}`;
	for (let n = 1; existsSync(join(dir.full, name)); n++) name = `${stem} ${n}${ext}`;
	writeFileSync(join(dir.full, name), bytes);
	return { path: dir.path ? `${dir.path}/${name}` : name, name };
}
