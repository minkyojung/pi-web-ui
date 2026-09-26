/**
 * Images pasted into the box, on their way to pi.
 *
 * The box hands over what was pasted as data URLs; pi's prompt() takes
 * images as base64 with a media type (its ImageContent, less the tag the
 * server adds). Only images go with the message: pi's models read those.
 * Any other file goes into the folder instead and is named in the message,
 * the way a note is — see filesToAttach.
 */

import { forFolder } from "./workspace.ts";
export interface PastedImage {
	data: string;
	mimeType: string;
	/** What it is kept under beside the message (attach.ts keepPictures): its own name, or one from the moment for a clipboard's "image.png". */
	name?: string;
}

/**
 * The files among those dropped or pasted that are not images: these do not
 * ride with the message but go into the folder (attach, below) and are named
 * in it. Which of them the folder takes is the server's to say — it holds the
 * one list of what the agent can read — so nothing is sorted out here.
 */
export function filesToAttach<F extends { type: string }>(files: Iterable<F>): F[] {
	return [...files].filter((f) => !f.type.startsWith("image/"));
}

/**
 * Put a file in the folder by the server's one door (attach.ts there) and
 * say where it went. A refusal comes back as the server worded it. `from` is
 * the note it is for, where there is one: a vault may keep such files beside
 * the note. `to: "message"` is for the message box instead, whose files are
 * kept out of the work (attach.ts saveMessageAttachment). `name` is for the
 * file that came without one worth keeping.
 */
export async function attach(file: File, { name = file.name, from = "", to }: { name?: string; from?: string; to?: "message" } = {}): Promise<string> {
	const res = await fetch(forFolder(`/api/attachment?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}${to ? `&to=${to}` : ""}`), {
		method: "POST",
		headers: { "content-type": "application/octet-stream" },
		body: file,
	});
	const said = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
	if (!res.ok || !said.path) throw new Error(said.error ?? `the server said ${res.status}`);
	return said.path;
}

/** The pasted images as pi takes them, each with the name it is kept under; anything that is not an image data URL is left out. */
export function imagesOf(files: { url?: string; mediaType?: string; filename?: string }[], now = new Date()): PastedImage[] {
	const out: PastedImage[] = [];
	for (const f of files) {
		const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(f.url ?? "");
		if (m) out.push({ mimeType: m[1]!, data: m[2]!, name: pastedName(f.filename ?? "", m[1]!, now) });
	}
	return out;
}

/**
 * The name a pasted picture is kept under. A clipboard's picture comes as
 * "image.png" whatever it shows, so that one is named from the moment, as
 * Obsidian names it; a file with a name of its own keeps it.
 */
export function pastedName(given: string, type: string, now = new Date()): string {
	const dot = given.lastIndexOf(".");
	const ext = dot > 0 ? given.slice(dot) : `.${(type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`;
	const stem = (dot > 0 ? given.slice(0, dot) : given).trim();
	if (!/^(image|screenshot|pasted image)?$/i.test(stem)) return `${stem}${ext}`;
	const p = (n: number) => String(n).padStart(2, "0");
	return `Pasted image ${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${ext}`;
}
