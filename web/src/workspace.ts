/**
 * Which workspace this page is a window on, for what the page keeps in the
 * browser.
 *
 * The browser keeps a page's things by its address, and the address here is
 * a port the shell hands out anew each run (electron/main.js) — so a port
 * kept the tabs of whichever workspace last had it, and two workspaces of one
 * repository, with every file named the same, swapped tabs without anyone
 * able to tell. The workspace is its folder: the server writes it into the
 * page as it is served (server.ts), before anything runs, and everything the
 * page keeps about a workspace is keyed by it here. A page with no folder
 * written in — the vite dev server, a browser tab — keeps its keys as they
 * were.
 *
 * What the page keeps about the window rather than the workspace — the
 * theme, the widths of the columns — is not keyed this way; that is the
 * shell's (preload.cjs `prefs`).
 */
import { FOLDER_META } from "../../folderMeta.ts";
import { createStore } from "./serverState.ts";

/** The key `name` is kept under for `folder`, or `name` itself with no folder. */
export const keyed = (name: string, folder: string | null): string => (folder ? `${name}@${folder}` : name);

/** The folder the server wrote into this page, or null where none did. */
/** The folder as the page's head says it, or null where none was written. */
function written(): string | null {
	if (typeof document === "undefined") return null;
	const content = document.querySelector(`meta[name="${FOLDER_META}"]`)?.getAttribute("content");
	return content ? content : null;
}

/**
 * The folder this page is a window on now. Seeded from the head, since the
 * server wrote it there before anything ran; changed by the shell when the
 * window moves to another workspace without the page being made again
 * (switch.ts), and the head kept in step so that whatever reads it — a
 * check driving the window — sees the same.
 */
export const folderStore = createStore<string | null>(written(), { window: true });

export const folderOf = (): string | null => folderStore.get();

export function setFolder(folder: string): void {
	if (typeof document !== "undefined") document.querySelector(`meta[name="${FOLDER_META}"]`)?.setAttribute("content", folder);
	folderStore.set(folder);
}

/** The key `name` is kept under in this page's browser storage. */
export const keyFor = (name: string): string => keyed(name, folderOf());

/**
 * `url` with this page's folder on it, for what the server answers per
 * folder — the socket, a note's text, a picture, an attachment. One server
 * serves every workspace, and which folder a request means is the page's
 * to say; a page with no folder written in asks as it always did, and the
 * server answers for the folder it was started in.
 */
export function forFolder(url: string): string {
	const folder = folderOf();
	if (!folder) return url;
	return `${url}${url.includes("?") ? "&" : "?"}folder=${encodeURIComponent(folder)}`;
}
