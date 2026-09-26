/**
 * Where the pictures a message names as chips are kept (pictures.ts picturesAt),
 * said beside it as the tab in front is (guard.ts): a hidden message of its
 * own, not the system prompt and not the person's words. The model has the
 * pictures themselves this turn; this is how it finds them again once a long
 * conversation has been summed up without them — pi's `read` shows a picture.
 * The paths are kept in `details` too, for what the conversation draws later.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function keptSaid(paths: readonly string[]): string {
	return `The pictures sent with this message are also kept in the folder, to look at again with read: ${paths.join(", ")}`;
}

export const sentPictures = (kept: () => readonly string[]) => (pi: ExtensionAPI) => {
	pi.on("before_agent_start", async () => {
		const paths = kept();
		if (paths.length === 0) return undefined;
		return { message: { customType: "attached", content: keptSaid(paths), display: false, details: { pictures: [...paths] } } };
	});
};
