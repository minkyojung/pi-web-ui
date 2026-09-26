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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

import { fileAt, messageFileAt } from "./vault.ts";

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

/**
 * A picture given in the message box, for the conversation to show over the
 * message it went with (conversation.js besideOf) and for the model to be
 * shown (workspace.ts). Not an SVG: the box takes any file, and that one can
 * carry a script.
 */
export function messagePictureAt(root: string, given: string): { path: string; full: string; type: string } | null {
	const file = messageFileAt(root, given);
	const type = file && imageType(file.path);
	if (type === "image/svg+xml") return null;
	return file && type && isFile(file.full) ? { ...file, type } : null;
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

/** What a model is shown as a picture; the rest of IMAGE_TYPES it is not given. */
const SHOWN = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Past this a picture is left for the agent to open by its path rather than put in the message. */
const SHOWN_BYTES = 20 * 1024 * 1024;

/**
 * The pictures a message names as chips, read from where the box kept them,
 * to be shown to the model with the message: each once, only kinds a model
 * reads, and only what is where the box keeps its files (messagePictureAt).
 * One that cannot be read is left out; its path is still in the message.
 */
export function picturesAt(root: string, paths: readonly unknown[]): { path: string; data: string; mimeType: string }[] {
	const out: { path: string; data: string; mimeType: string }[] = [];
	for (const path of new Set(paths.filter((p): p is string => typeof p === "string"))) {
		const found = messagePictureAt(root, path);
		if (!found || !SHOWN.has(found.type)) continue;
		try {
			if (statSync(found.full).size > SHOWN_BYTES) continue;
			out.push({ path, data: readFileSync(found.full).toString("base64"), mimeType: found.type });
		} catch {
			// Gone since it was named: the path in the message says what it was.
		}
	}
	return out;
}
