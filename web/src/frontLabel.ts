/**
 * What the strip over the message box says of the tab in front, which is
 * what goes beside the message (Composer.tsx, guard.ts): a mark for what
 * kind of thing it is, and the name the tab row already calls it by — the
 * strip and the tab are the same thing seen twice, so they say it the same
 * way. A task is said as Linear says an issue over its agent's box: where it
 * stands, its number, its line.
 *
 * Null for a tab that is nothing to the conversation — what is new in this
 * version — which guard.ts says nothing of either.
 */
import type { SpecInfo } from "../../protocol.ts";
import { titleOf } from "../../naming.ts";
import { pageOf } from "./pages.ts";
import { taskOfCommit } from "./resultsList.ts";
import type { Standing } from "./taskTree.ts";

export type FrontLabel =
	| { kind: "note" | "code" | "document"; name: string }
	| { kind: "task"; id: string; name: string | null; standing: Standing }
	| { kind: "commit"; id: string; name: string | null }
	| { kind: "changes"; name: string };

export function frontLabel(specs: readonly SpecInfo[] | null, address: string): FrontLabel | null {
	const page = pageOf(address);
	// An address under the app's scheme that names no page is no note either.
	if (!page) return address.startsWith("octave://") ? null : { kind: "note", name: titleOf(address) };
	switch (page.kind) {
		case "document":
		case "code":
			return { kind: page.kind, name: page.title };
		case "task": {
			// As the tab reads it (resultsList.ts taskTabTitle): the run in review
			// first, then the last result — and where it stands is which of the two.
			const spec = specs?.find((entry) => entry.name === page.spec);
			const review = spec?.review.find((run) => run.task === page.task);
			const done = spec?.results.findLast((result) => result.task === page.task);
			return { kind: "task", id: page.task, name: review?.title ?? done?.title ?? null, standing: review ? "review" : done ? "done" : "todo" };
		}
		case "commit": {
			const of = taskOfCommit(specs, page.commit);
			return { kind: "commit", id: page.title, name: of ? `Task ${of.task} · ${of.title}` : null };
		}
		case "changes":
			return { kind: "changes", name: page.title };
		case "whats-new":
			return null;
	}
}
