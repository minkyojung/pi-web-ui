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
import { readdirSync, statSync } from "node:fs";
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
