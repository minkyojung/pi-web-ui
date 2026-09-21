/**
 * Where a spec stands, in the words the window says it in.
 *
 * Two places say it — the control at the start of the tab row and the bar over
 * a document waiting to be approved — and they must not be able to disagree,
 * so the arithmetic and the wording are here and both of them only draw. The
 * state itself is the server's, read off the files (SpecsMsg); nothing here
 * decides anything about approval, it only reads what came.
 *
 * Pure, and tested without a browser.
 */
import { SPEC_DOCS, SPECS_DIR, specNameOf, type SpecDoc } from "../../documentKinds.ts";
import type { SpecInfo } from "../../protocol.ts";

/**
 * What has become of one of a spec's documents.
 *
 * `written` is the one that needs the server's list: a document that is on the
 * disk but is not the one waiting, because a document before it was changed
 * after everything was approved. It can be read; it is not approved as things
 * stand. `unwritten` is one the agent has not written at all.
 */
export type Standing = "approved" | "waiting" | "written" | "unwritten";

/** Where a spec's document is, as a path from the folder. */
export const docPath = (name: string, doc: SpecDoc): string => `${SPECS_DIR}${name}/${doc}`;

/**
 * The spec waiting for the person, and of several the one whose document was
 * written last — which is the one they have just been given. The tab that
 * opens by itself and the control that names a spec ask this same question,
 * so they cannot name two different specs.
 */
export function waitingSpec(specs: readonly SpecInfo[]): SpecInfo | null {
	let best: SpecInfo | null = null;
	// At least as new wins, so that of several written in the same millisecond
	// — or of several the disk cannot date — it is the last listed.
	for (const spec of specs) {
		if (spec.waiting === null) continue;
		if (!best || (spec.waitingAt ?? 0) >= (best.waitingAt ?? 0)) best = spec;
	}
	return best;
}

/** What has become of one document of one spec. */
export function docStanding(spec: SpecInfo, doc: SpecDoc): Standing {
	if (SPEC_DOCS.indexOf(doc) < spec.approved) return "approved";
	if (spec.waiting === doc) return "waiting";
	return spec.written.includes(doc) ? "written" : "unwritten";
}

/**
 * The document that speaks for a spec: the one waiting for the person, and
 * with none waiting the one the spec has got to — the last approved when they
 * all are, else the next one to be written.
 */
export function standingOf(spec: SpecInfo): { doc: SpecDoc; standing: Standing } {
	const doc = spec.waiting ?? SPEC_DOCS[Math.min(spec.approved, SPEC_DOCS.length - 1)];
	return { doc, standing: docStanding(spec, doc) };
}

/**
 * Which spec the control names: the one waiting, since that is the one with
 * something for the person to do; else the one they are reading; else the
 * first, which is the folder's own order.
 */
export function speaksFor(specs: readonly SpecInfo[], open: string | null): SpecInfo | null {
	const waiting = waitingSpec(specs);
	if (waiting) return waiting;
	const name = open === null ? null : specNameOf(open);
	const reading = name === null ? undefined : specs.find((spec) => spec.name === name);
	return reading ?? specs[0] ?? null;
}

const TITLES: Record<SpecDoc, string> = { "requirements.md": "Requirements", "design.md": "Design", "tasks.md": "Tasks" };

/** A document's name as it is shown: the spec's language, not the file's. */
export const docTitle = (doc: SpecDoc): string => TITLES[doc];

const WORDS: Record<Standing, string> = { approved: "Approved", waiting: "Waiting", written: "Not approved", unwritten: "Not written yet" };

/** What has become of a document, for the list where the document is already named. */
export const standingWord = (standing: Standing): string => WORDS[standing];

const PHRASES: Record<Standing, string> = { approved: "approved", waiting: "waiting", written: "not approved", unwritten: "not written yet" };

/**
 * A spec in three or four words, for the control that names it: which
 * document it is on and how that stands — and once all three are approved,
 * how far its tasks have got, since "Tasks approved" stops being news the
 * moment it is true and what is happening from then on is the tasks.
 */
export function stateWords(spec: SpecInfo): string {
	const progress = progressWords(spec);
	if (progress) return progress;
	const { doc, standing } = standingOf(spec);
	return `${docTitle(doc)} ${PHRASES[standing]}`;
}

/**
 * How far a spec's tasks have got, as `3 / 8` — done over to do — and
 * `8 / 8 done` at the end, or null while the spec is not yet at its tasks.
 * Counted by the server off tasks.md (SpecInfo.tasks): the tasks that are
 * work of their own, a heading with sub-tasks being checked when they are.
 */
export function progressWords(spec: SpecInfo): string | null {
	if (spec.approved < SPEC_DOCS.length || !spec.tasks) return null;
	const { done, total } = spec.tasks;
	if (total === 0) return null;
	return `${done} / ${total}${done === total ? " done" : ""}`;
}

/** The line over a document that is waiting to be approved. */
export const waitingLine = (doc: SpecDoc): string => `${docTitle(doc)} waiting for your approval`;
