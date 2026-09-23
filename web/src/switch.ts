/**
 * The window moved to another workspace without the page being made again.
 *
 * A switch used to be a navigation: the shell pointed the window at the
 * other workspace's address, and everything the page was — its stores, its
 * socket, its editor, the code itself — was thrown away and built back.
 * Now one server serves every workspace and the page stays: the shell says
 * which folder (preload `onShow`), and this is what changes hands — in
 * this order, since each step reads the one before.
 *
 *   1. The folder: what every key and address is made from (workspace.ts).
 *   2. The state: every store of the server's cleared to how it began, the
 *      conversation emptied, the drafts swapped — nothing of the folder
 *      left shows until the new folder's own arrives.
 *   3. What the page keeps by folder — open folders, seen results — read
 *      again under the new keys.
 *   4. The socket, opened again on the new folder's address: the server
 *      attaches it there and sends the state it needs to start.
 *   5. The tree of components, remade under a key (main.tsx): its tabs, its
 *      history and its editor begin from the new folder's own.
 *
 * What is the window's rather than the folder's — the theme, the widths,
 * the settings screen, the GitHub sign-in — stays as it is.
 */
import { switchDraft } from "./draft";
import { wireFirstSpec } from "./firstSpecWire";
import { beginSwitch } from "./landing";
import { reloadSeen } from "./seenResults";
import { resetAll } from "./serverState";
import { replaceConversation } from "./store";
import { reloadOpenFolders } from "./tree";
import { folderOf, setFolder } from "./workspace";
import { reconnect } from "./ws";

export function switchWorkspace(folder: string): void {
	const from = folderOf();
	if (from === folder) return;
	beginSwitch();
	setFolder(folder);
	resetAll();
	replaceConversation([]);
	switchDraft(from, folder);
	reloadOpenFolders();
	reloadSeen();
	reconnect();
	// And what this workspace was made to be told first, if it was made for a spec.
	wireFirstSpec();
}
