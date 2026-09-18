/**
 * A picture pasted or dropped into a note goes into the folder and the note
 * says `![[its name]]` where the cursor is — what Obsidian does with a
 * screenshot, and the only way to put a picture in a note short of moving
 * the file by hand. The server keeps it (POST /api/attachment) where the
 * folder keeps pictures; the note names it by name alone, which the server
 * finds wherever it is (pictures.ts).
 */
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

const IMAGE = /^image\//;

async function keep(view: EditorView, files: File[], here: string): Promise<void> {
	// One after another, each at the cursor as it stands then, so two pictures
	// land in order.
	for (const file of files) {
		const name = file.name || `image.${(file.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`;
		const res = await fetch(`/api/attachment?from=${encodeURIComponent(here)}&name=${encodeURIComponent(name)}`, {
			method: "POST",
			headers: { "content-type": file.type || "application/octet-stream" },
			body: file,
		});
		if (!res.ok) continue;
		const { name: saved } = (await res.json()) as { name: string };
		const at = view.state.selection.main.head;
		view.dispatch({ changes: { from: at, insert: `![[${saved}]]` }, selection: { anchor: at + saved.length + 5 }, userEvent: "input.paste" });
	}
}

const picturesIn = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter((f) => IMAGE.test(f.type));

export function pasteImage(here: () => string): Extension {
	return EditorView.domEventHandlers({
		paste(event, view) {
			const files = picturesIn(event.clipboardData?.files);
			if (files.length === 0) return false;
			event.preventDefault();
			void keep(view, files, here());
			return true;
		},
		drop(event, view) {
			const files = picturesIn(event.dataTransfer?.files);
			if (files.length === 0) return false;
			event.preventDefault();
			// Where it was dropped, not where the cursor was.
			const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (pos !== null) view.dispatch({ selection: { anchor: pos } });
			void keep(view, files, here());
			return true;
		},
	});
}
