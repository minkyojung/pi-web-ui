/**
 * The folder the server works in, written into the page it serves.
 *
 * The page keeps its tabs and the like in the browser by workspace, and has
 * to know which workspace it is before anything of it runs — before the
 * socket has said (web/src/workspace.ts). So the server writes the folder
 * into `index.html`'s head as it serves it, as a meta the page reads first.
 * Pure, so the escaping is tested without a server.
 */
export const FOLDER_META = "octave-folder";

/** `html` with the meta written in after `<head>`; HTML with no head as it is. A path is not HTML, so what HTML would read is escaped. */
export function folderMeta(html: string, folder: string): string {
	const safe = folder.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return html.replace("<head>", `<head>\n<meta name="${FOLDER_META}" content="${safe}">`);
}
