/**
 * Images pasted into the box, on their way to pi.
 *
 * The box hands over what was pasted as data URLs; pi's prompt() takes
 * images as base64 with a media type (its ImageContent, less the tag the
 * server adds). Only images go with the message: pi's models read those.
 * Any other file goes into the folder instead and is named in the message,
 * the way a note is — see filesToAttach.
 */
export interface PastedImage {
	data: string;
	mimeType: string;
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
 * say where it went. A refusal comes back as the server worded it.
 */
export async function attach(file: File): Promise<string> {
	const res = await fetch(`/api/attachment?name=${encodeURIComponent(file.name)}`, {
		method: "POST",
		headers: { "content-type": "application/octet-stream" },
		body: file,
	});
	const said = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
	if (!res.ok || !said.path) throw new Error(said.error ?? `the server said ${res.status}`);
	return said.path;
}

/** The pasted images as pi takes them; anything that is not an image data URL is left out. */
export function imagesOf(files: { url?: string; mediaType?: string }[]): PastedImage[] {
	const out: PastedImage[] = [];
	for (const f of files) {
		const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(f.url ?? "");
		if (m) out.push({ mimeType: m[1]!, data: m[2]! });
	}
	return out;
}
