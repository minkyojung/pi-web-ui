import { ChangeSet } from "@codemirror/state";

import type { Change } from "./types";

/**
 * What the editor does with a note the server sends.
 *
 * The server sends the note to every tab after every write — the editor's
 * own, pi's, another tab's — so most of what arrives is either the echo of a
 * save this editor made or a change it should simply show. The one case that
 * needs a person is a write from elsewhere landing while there is unsaved
 * typing here; the save that typing would make is refused anyway, so it is
 * put to them the same way a refused save is.
 *
 * Pure, so the cases can be pinned without a CodeMirror.
 */
export type Editing = {
	/** What the editor shows. */
	doc: string;
	/** The text of the last save sent and not yet answered, if any. */
	sent: string | null;
	/** Whether `doc` differs from the last version this editor knew was saved. */
	dirty: boolean;
};

export type Incoming = { text: string; modified: number };

export type Decision =
	/** The echo of this editor's save. The doc may have moved on since. */
	| { kind: "saved"; dirty: boolean }
	/** The same text from elsewhere: nothing to show, only a newer version to save on top of. */
	| { kind: "same" }
	/** Different text and nothing unsaved here: show it. */
	| { kind: "replace" }
	/** Different text under unsaved typing: someone must choose. */
	| { kind: "conflict" };

export function decide(editing: Editing, incoming: Incoming): Decision {
	if (editing.sent !== null && incoming.text === editing.sent) {
		return { kind: "saved", dirty: editing.doc !== editing.sent };
	}
	if (incoming.text === editing.doc) return { kind: "same" };
	if (!editing.dirty) return { kind: "replace" };
	return { kind: "conflict" };
}

/** The note named in the address, or null. `#` alone is nothing open. */
export function noteFromHash(hash: string): string | null {
	if (!hash.startsWith("#") || hash.length < 2) return null;
	try {
		const path = decodeURIComponent(hash.slice(1));
		return path.endsWith(".md") ? path : null;
	} catch {
		return null;
	}
}

export const hashForNote = (path: string) => `#${encodeURIComponent(path).replace(/%2F/g, "/")}`;

/** The text after the server's changes, applied in order. */
export function applyChanges(text: string, changes: Change[]): string {
	for (const c of changes) text = text.slice(0, c.from) + c.inserted + text.slice(c.to);
	return text;
}

/**
 * The server's changes as one CodeMirror change set over the version they
 * start from. Each change is in the text as it is when applied, so they are
 * composed in order rather than laid side by side.
 */
export function changeSetOf(changes: Change[], baseLength: number): ChangeSet {
	let set = ChangeSet.empty(baseLength);
	for (const c of changes) {
		set = set.compose(ChangeSet.of({ from: c.from, to: c.to, insert: c.inserted }, set.newLength));
	}
	return set;
}

/**
 * A change from the server, made to fit under changes typed here since the
 * same version — or nothing, if they touch the same text.
 *
 * Both start from the same document. If the server's change reaches into any
 * range the typing changed, the two cannot both stand and a person has to
 * choose; otherwise each is mapped through the other: `theirs` becomes the
 * change to apply to what is on screen, and `ours` the typing as it now sits
 * over the server's new text, which is what the next save is measured from.
 */
export function rebase(theirs: ChangeSet, ours: ChangeSet): { theirs: ChangeSet; ours: ChangeSet } | null {
	let overlap = false;
	theirs.iterChangedRanges((from, to) => {
		if (ours.touchesRange(from, to)) overlap = true;
	});
	if (overlap) return null;
	return { theirs: theirs.map(ours), ours: ours.map(theirs, true) };
}
