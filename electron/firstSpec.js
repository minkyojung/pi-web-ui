/**
 * What a new workspace is to be told first: the line typed in the new spec
 * dialog, and the model and effort chosen beside it.
 *
 * The dialog is on one page and the workspace opens on another — the window
 * is loaded again from the new folder's server — so the shell holds this in
 * between, by the workspace's folder, and the new page takes it once it is
 * up. Taken, it is gone: a page loaded again does not start the spec twice,
 * which is the worse of the two ways this can go wrong.
 *
 * Pure: what came from the page is read strictly here, since it came over
 * IPC, and the holding is a map — both tested without a window.
 */

/** Long enough for a paragraph of what to build; a pasted file is not a line. */
const LONGEST = 4000;

const word = (value, shape) => (typeof value === "string" && shape.test(value) ? value : null);

/**
 * The first message as the shell keeps it, or null for anything that is not
 * one. The line is made one line — `/spec` takes a line, and the box it was
 * typed in takes several. A model is `provider/id` as the picker keys it and
 * an effort is one of pi's words; whether there is such a model is the
 * page's to find out, where the list is.
 */
export function firstFrom(value) {
	if (!value || typeof value.line !== "string") return null;
	const line = value.line.replace(/\s+/g, " ").trim();
	if (!line || line.length > LONGEST) return null;
	return { line, model: word(value.model, /^[^\s/]+\/\S+$/), effort: word(value.effort, /^[a-z]+$/) };
}

/** The first messages waiting for their workspaces. */
export function firsts() {
	const waiting = new Map();
	return {
		keep: (workdir, first) => void waiting.set(workdir, first),
		/** The one for this workspace, once. */
		take: (workdir) => {
			const first = waiting.get(workdir) ?? null;
			waiting.delete(workdir);
			return first;
		},
	};
}
