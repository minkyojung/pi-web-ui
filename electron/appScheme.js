/**
 * The app's own pages, served from the build under a scheme of its own.
 *
 * Some screens come before there is any server to serve them — the one that
 * adds a first repository. They are pages of the same build as the rest,
 * given out by this process as `octave://app/<file>`. A scheme of the app's
 * own rather than file://, which Electron's security guidance asks for: a
 * page on file:// may read any file the user can, and one here may read only
 * the build.
 */
import { resolve, sep } from "node:path";

export const SCHEME = "octave";

/** The address of one of the build's pages. */
export const pageUrl = (file) => `${SCHEME}://app/${file}`;

/**
 * The file in `root` an address names, or null for one that names none —
 * another host, or a path that climbs out of the build in any encoding.
 */
export function fileFor(root, address) {
	let url;
	try {
		url = new URL(address);
	} catch {
		return null;
	}
	if (url.protocol !== `${SCHEME}:` || url.host !== "app") return null;
	let path;
	try {
		path = decodeURIComponent(url.pathname);
	} catch {
		return null;
	}
	const base = resolve(root);
	const full = resolve(base, `.${path}`);
	return full.startsWith(base + sep) ? full : null;
}
