/**
 * The editors on this machine, as macOS knows them.
 *
 * A file in the window is read and not written (docs/spec-mode), so the way
 * to change one is the editor the person already uses. Which they have is not
 * something to ask them: macOS knows, and the question to ask it is which app
 * is registered for a URL scheme — `cursor://`, `vscode://`, `zed://`.
 *
 * A scheme rather than what an app can open. Both were looked at:
 *
 * - `CFBundleDocumentTypes` is the honest signal — an app declares there that
 *   it *edits* these kinds of file, and it is what the Finder's Open With is
 *   built from. But the declarations disagree. Xcode claims
 *   `public.source-code`; Zed claims only `public.plain-text`; Cursor lists
 *   extensions one by one and claims no source-code type at all. A query by
 *   kind misses the editor people actually use, and reading it properly needs
 *   Launch Services through native code, which a page cannot reach.
 * - `LSApplicationCategoryType` is worse: Zed declares none, and asking
 *   Spotlight for the developer-tools category answers with 1Password, Linear,
 *   Docker and every Electron.app sitting in a node_modules.
 *
 * A scheme is not a claim about capability; it is a registration, and only
 * Cursor registers `cursor://`. So there are no false positives, and "is it
 * installed" is the same question as "did macOS answer" — with the app's own
 * name, icon and path in the answer, which is what the menu draws.
 *
 * The list of schemes is short and hard-coded, and that is the point: the
 * alternative is a table of bundle identifiers, and Cursor's is
 * `com.todesktop.230313mzl4w4u92`.
 *
 * Pure: what macOS says comes in, what to do comes out, so the deciding is
 * tested without a Launch Services or a window.
 */

/**
 * How each editor is asked for, and what opening a file in it means.
 *
 * Most take VS Code's URL, which its forks kept. Zed is the exception: its
 * binary knows `zed://settings/` and `zed://schemas/` and no `zed://file/`
 * at all, so it is opened by the command inside its own bundle — the one
 * macOS just told us where to find — which takes `path:line` as VS Code's
 * `-g` does.
 *
 * JetBrains is left out for now. Its URL wants the project's name as well as
 * the file's path (`jetbrains://pycharm/navigate/reference?project=…`), and a
 * name we would have to guess is a link that silently opens the wrong thing.
 */
const EDITORS = [
	{ scheme: "cursor://", opening: byUrl("cursor") },
	{ scheme: "vscode://", opening: byUrl("vscode") },
	{ scheme: "vscode-insiders://", opening: byUrl("vscode-insiders") },
	{ scheme: "windsurf://", opening: byUrl("windsurf") },
	{ scheme: "zed://", opening: byCommand("Contents/MacOS/cli") },
];

/**
 * VS Code's own: `vscode://file/<absolute path>:<line>`. The path is absolute
 * and so begins with the slash the form wants after `file`. Encoded, since a
 * folder named with a `#` or a space would otherwise end the URL early.
 */
function byUrl(scheme) {
	return (_app, file, line) => ({ url: `${scheme}://file${asUrlPath(file)}:${line}` });
}

/**
 * A path as a URL's path. encodeURI leaves `#` and `?` alone — they are a
 * URL's own punctuation — and a folder named with either would end the link
 * before the file did, so those two are spelled out by hand. The slashes stay
 * slashes, which is why this is not encodeURIComponent.
 */
const asUrlPath = (file) => encodeURI(file).replace(/#/g, "%23").replace(/\?/g, "%3F");

/** The command inside the app's own bundle, which is where macOS said the app is. */
function byCommand(inside) {
	return (app, file, line) => ({ command: `${app}/${inside}`, args: [`${file}:${line}`] });
}

/**
 * What to call it. macOS answers with the bundle's file name — `Cursor.app` —
 * and the `.app` is the file system's word, not the app's; nowhere else in
 * the window is a program called that. Falls back to the bundle at the end of
 * the path for an answer that carries no name at all.
 */
function displayName(name, path) {
	const said = (name || path.slice(path.lastIndexOf("/") + 1)).trim();
	return said.endsWith(".app") ? said.slice(0, -4) : said;
}

/**
 * The editors macOS has a handler for, in the order above.
 *
 * `ask` is the one thing this cannot do itself: given a scheme, the `{ name,
 * path }` of the app registered for it, or null. The caller hands in Electron's
 * `app.getApplicationInfoForProtocol`.
 *
 * Deduplicated by the app's path, because one app answers to more than one
 * scheme: Cursor registers `vscode://` as well as its own, being a fork of it,
 * and a menu that offered it twice under two names would be saying there are
 * two editors. The first scheme to reach an app is the one it is opened by.
 */
export async function editorsOn(ask) {
	const found = [];
	for (const editor of EDITORS) {
		const app = await ask(editor.scheme).catch(() => null);
		if (!app?.path || found.some((one) => one.path === app.path)) continue;
		found.push({ scheme: editor.scheme, name: displayName(app.name, app.path), path: app.path, icon: app.icon ?? null });
	}
	return found;
}

/**
 * What opening `file` at `line` in the editor registered for `scheme` means —
 * `{ url }` for the shell to open, or `{ command, args }` to run — or null for
 * a scheme this does not know.
 */
export function openingOf(scheme, appPath, file, line) {
	const editor = EDITORS.find((one) => one.scheme === scheme);
	return editor ? editor.opening(appPath, file, Math.max(1, Math.floor(line) || 1)) : null;
}
