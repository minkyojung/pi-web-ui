/**
 * Images pasted into the box, on their way to pi.
 *
 * The box hands over what was pasted as data URLs; pi's prompt() takes
 * images as base64 with a media type (its ImageContent, less the tag the
 * server adds). Only images go: pi's models read those, and the box accepts
 * nothing else. Pure, so it can be tested without a clipboard.
 */
export interface PastedImage {
	data: string;
	mimeType: string;
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
